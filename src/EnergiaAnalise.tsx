import { useEffect, useMemo, useState } from 'react';
import { FiCheckCircle, FiCloudRain, FiClock, FiWind, FiZap } from 'react-icons/fi';
import { consultarOpenMeteoComCache } from './openMeteoCache';
import {
  duracaoObservadaEnergiaMs,
  statusDoAlerta,
  subcategoriasDoAlerta,
  type AlertaTerritorial
} from './territorioOcorrencias';
import './energiaAnalise.css';

type Props = {
  alertas: AlertaTerritorial[];
  modo: 'atuais' | 'historico';
  inicioPeriodo: number;
  fimPeriodo: number;
  periodoValido: boolean;
  subcategoria: string;
  agora: number;
};

type ContextoTempo = {
  precipitacao: number | null;
  rajada: number | null;
  horario: string;
};

const DIA = 86_400_000;
const HORA = 3_600_000;
const dataHora = (valor: number) =>
  new Date(valor).toLocaleString('pt-BR', {
    day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
    timeZone: 'America/Fortaleza'
  });

function duracaoLegivel(ms: number): string {
  const minutos = Math.round(ms / 60_000);
  if (minutos < 60) return `${minutos} min`;
  const horas = Math.floor(minutos / 60);
  const resto = minutos % 60;
  return `${horas}h${resto ? ` ${resto}min` : ''}`;
}

/**
 * Relaciona informações meteorológicas ao momento do relato, não ao momento
 * atual e sem atribuir causalidade à concessionária ou à tempestade.
 * Um único alerta selecionado dispara a consulta (cache já compartilhado).
 */
async function consultarContexto(alerta: AlertaTerritorial, agora: number, signal: AbortSignal) {
  if (!alerta.criadoEm || alerta.criadoEm > agora ||
      !Number.isFinite(alerta.latitude) || !Number.isFinite(alerta.longitude)) {
    throw new Error('Este relato não possui horário ou localização válidos.');
  }

  const diaLocal = new Date(alerta.criadoEm - 3 * HORA).toISOString().slice(0, 10);
  const recente = agora - alerta.criadoEm <= 6 * DIA;
  const endpoint = recente
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';
  const parametros = new URLSearchParams({
    latitude: String(Number(alerta.latitude.toFixed(4))),
    longitude: String(Number(alerta.longitude.toFixed(4))),
    hourly: 'precipitation,wind_gusts_10m',
    timezone: 'America/Fortaleza'
  });
  if (recente) {
    parametros.set('past_days', '7');
    parametros.set('forecast_days', '1');
  } else {
    parametros.set('start_date', diaLocal);
    parametros.set('end_date', diaLocal);
  }

  const resposta = await consultarOpenMeteoComCache(
    `${endpoint}?${parametros.toString()}`, signal
  );
  const corpo = resposta as {
    hourly?: {
      time?: unknown;
      precipitation?: unknown;
      wind_gusts_10m?: unknown;
    };
  };
  const horarios = corpo.hourly?.time;
  if (!Array.isArray(horarios)) throw new Error('Dados horários indisponíveis para esta data.');

  // A Open-Meteo devolve horário local quando timezone=America/Fortaleza.
  const horaLocal = new Date(alerta.criadoEm - 3 * HORA).toISOString().slice(0, 13);
  const indice = horarios.findIndex((hora: unknown) =>
    typeof hora === 'string' && hora.slice(0, 13) === horaLocal
  );
  if (indice < 0) throw new Error('Sem observação estimada no horário do relato.');
  const chuva = Array.isArray(corpo.hourly?.precipitation)
    ? corpo.hourly.precipitation[indice] : null;
  const vento = Array.isArray(corpo.hourly?.wind_gusts_10m)
    ? corpo.hourly.wind_gusts_10m[indice] : null;
  if (typeof chuva !== 'number' && typeof vento !== 'number') {
    throw new Error('Sem valores meteorológicos disponíveis para este horário.');
  }
  return {
    precipitacao: typeof chuva === 'number' && Number.isFinite(chuva) ? chuva : null,
    rajada: typeof vento === 'number' && Number.isFinite(vento) ? vento : null,
    horario: dataHora(alerta.criadoEm)
  } satisfies ContextoTempo;
}

export default function EnergiaAnalise({
  alertas, modo, inicioPeriodo, fimPeriodo, periodoValido, subcategoria, agora
}: Props) {
  const [idConsulta, setIdConsulta] = useState<string | null>(null);
  const [contexto, setContexto] = useState<ContextoTempo | null>(null);
  const [erroContexto, setErroContexto] = useState<string | null>(null);
  const [consultando, setConsultando] = useState(false);

  const registros = useMemo(() => alertas.filter(alerta => {
    if (alerta.categoria !== 'Energia' || !alerta.criadoEm) return false;
    if (subcategoria !== 'Todas' && !subcategoriasDoAlerta(alerta).includes(subcategoria))
      return false;
    if (modo === 'historico') return periodoValido &&
      alerta.criadoEm >= inicioPeriodo && alerta.criadoEm <= fimPeriodo;
    // Não diz que os registros passados estavam ativos: recorte é por criação.
    return alerta.criadoEm >= agora - 30 * DIA && alerta.criadoEm <= agora;
  }), [alertas, modo, inicioPeriodo, fimPeriodo, periodoValido, subcategoria, agora]);

  const registrados = useMemo(
    () => [...registros].sort((a, b) => (b.criadoEm ?? 0) - (a.criadoEm ?? 0)),
    [registros]
  );
  const restabelecidos = registros.filter(alerta =>
    duracaoObservadaEnergiaMs(alerta) !== null
  );
  const duracoes = restabelecidos.map(alerta => duracaoObservadaEnergiaMs(alerta)!);
  const media = duracoes.length
    ? duracoes.reduce((total, ms) => total + ms, 0) / duracoes.length
    : null;
  const encerradosSemHorario = registros.filter(alerta =>
    statusDoAlerta(alerta, agora) === 'resolvido' &&
    duracaoObservadaEnergiaMs(alerta) === null
  ).length;
  const ativos = registros.filter(alerta => statusDoAlerta(alerta, agora) === 'ativo').length;

  const selecionado = registrados.find(alerta => alerta.id === idConsulta) ?? null;

  useEffect(() => {
    if (!selecionado) return;
    const abortador = new AbortController();
    setConsultando(true);
    setErroContexto(null);
    setContexto(null);
    void consultarContexto(selecionado, agora, abortador.signal)
      .then(dados => {
        if (!abortador.signal.aborted) setContexto(dados);
      })
      .catch(falha => {
        if (!abortador.signal.aborted) {
          setErroContexto(falha instanceof Error ? falha.message : 'Consulta indisponível.');
        }
      })
      .finally(() => {
        if (!abortador.signal.aborted) setConsultando(false);
      });
    return () => abortador.abort();
    // Consulta muda apenas quando o usuário seleciona um relato ou ele muda de data/local.
  }, [selecionado?.id, selecionado?.criadoEm, selecionado?.latitude, selecionado?.longitude]);

  return (
    <section className="energia-analise" aria-label="Análise dos relatos de energia">
      <div className="energia-analise__topo">
        <h2><FiZap aria-hidden="true" /> Energia | Acompanhamento comunitário</h2>
        <small>{modo === 'historico'
          ? 'Relatos criados no período selecionado'
          : 'Relatos criados nos últimos 30 dias'}</small>
      </div>

      <div className="energia-analise__indicadores">
        <div><strong>{ativos}</strong><span>Relatos ativos</span></div>
        <div><strong>{restabelecidos.length}</strong><span>Retornos confirmados com horário</span></div>
        <div><strong>{media === null ? '—' : duracaoLegivel(media)}</strong>
          <span>Tempo médio entre relato e retorno</span></div>
      </div>

      <p className="energia-analise__ressalva">
        <FiClock size={13} aria-hidden="true" />
        Tempo observado desde o registro comunitário até a confirmação de retorno;
        não é a duração oficial da interrupção. {encerradosSemHorario > 0 &&
          `${encerradosSemHorario} relato(s) resolvido(s) sem horário de retorno não entraram na média.`}
      </p>

      {registrados.length ? (
        <div className="energia-analise__registros">
          {registrados.slice(0, 8).map(alerta => {
            const duracao = duracaoObservadaEnergiaMs(alerta);
            const estado = statusDoAlerta(alerta, agora);
            return (
              <div key={alerta.id} className="energia-analise__registro">
                <div className="energia-analise__registro-texto">
                  <strong>{subcategoriasDoAlerta(alerta).join(' · ')}</strong>
                  <span>{dataHora(alerta.criadoEm!)} · {estado === 'resolvido'
                    ? 'Resolvido pela comunidade'
                    : estado === 'ativo' ? 'Relato ativo' : 'Relato expirado'}</span>
                  {duracao !== null && (
                    <small><FiCheckCircle size={12} aria-hidden="true" />
                      Retorno informado em {dataHora(alerta.restabelecidoEm!)}
                      {' · '}{duracaoLegivel(duracao)} após o relato</small>
                  )}
                </div>
                <button type="button" aria-pressed={idConsulta === alerta.id}
                  onClick={() => setIdConsulta(id => id === alerta.id ? null : alerta.id)}>
                  {idConsulta === alerta.id ? 'Ocultar clima' : 'Clima no relato'}
                </button>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="energia-analise__vazio">Nenhum registro de energia neste recorte.</p>
      )}

      {selecionado && (
        <div className="energia-analise__contexto" role="status" aria-live="polite">
          <strong>Contexto meteorológico · {dataHora(selecionado.criadoEm!)}</strong>
          {consultando ? <p>Consultando dados horários da Open-Meteo…</p> :
            erroContexto ? <p>{erroContexto}</p> :
            contexto ? (
              <div className="energia-analise__meteorologia">
                <span><FiCloudRain aria-hidden="true" /> Chuva estimada: {
                  contexto.precipitacao === null ? 'indisponível'
                    : `${contexto.precipitacao.toFixed(1).replace('.', ',')} mm`
                }</span>
                <span><FiWind aria-hidden="true" /> Rajadas estimadas: {
                  contexto.rajada === null ? 'indisponíveis'
                    : `${contexto.rajada.toFixed(1).replace('.', ',')} km/h`
                }</span>
              </div>
            ) : null}
          <small>Fonte: Open-Meteo (modelo meteorológico). Associação temporal e espacial,
            sem confirmação de causa da falha elétrica. Não são dados da Enel.</small>
        </div>
      )}
    </section>
  );
}
