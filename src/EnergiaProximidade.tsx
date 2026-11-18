import { useEffect, useMemo, useState } from 'react';
import { FiCloudRain, FiMapPin, FiWind } from 'react-icons/fi';
import { consultarOpenMeteoComCache } from './openMeteoCache';
import { subcategoriasDoAlerta, type AlertaTerritorial } from './territorioOcorrencias';

type Props = {
  registros: AlertaTerritorial[];
  agora: number;
};

type Grupo = {
  id: string;
  relatos: AlertaTerritorial[];
  primeiro: number;
  ultimo: number;
  latitude: number;
  longitude: number;
  distanciaMaxima: number;
};

type ClimaEntorno = {
  chuvaAcumulada: number | null;
  maiorRajada: number | null;
  horariosValidos: number;
  inicio: number;
  fim: number;
};

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const RAIO_KM = 3;
const INTERVALO_MS = 3 * HORA;
const formatoData = (instante: number) => new Date(instante).toLocaleString('pt-BR', {
  day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
  timeZone: 'America/Fortaleza'
});
const formatoNumero = (valor: number, casas = 1) =>
  valor.toLocaleString('pt-BR', { minimumFractionDigits: casas, maximumFractionDigits: casas });

function distanciaKm(a: AlertaTerritorial, b: AlertaTerritorial): number {
  const rad = Math.PI / 180;
  const dLat = (b.latitude - a.latitude) * rad;
  const dLon = (b.longitude - a.longitude) * rad;
  const h = Math.sin(dLat / 2) ** 2 +
    Math.cos(a.latitude * rad) * Math.cos(b.latitude * rad) *
    Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(Math.max(0, h))));
}

function pontoValido(relato: AlertaTerritorial): boolean {
  return typeof relato.criadoEm === 'number' && Number.isFinite(relato.criadoEm) &&
    relato.criadoEm > 0 &&
    Number.isFinite(relato.latitude) && Math.abs(relato.latitude) <= 90 &&
    Number.isFinite(relato.longitude) && Math.abs(relato.longitude) <= 180;
}

/**
 * Grupos exploratórios, sem duplicar relatos:
 * cada documento fica próximo (<= 3 km e <= 3 h) do primeiro registro do grupo.
 * O agrupamento NÃO representa a área atingida pela rede elétrica.
 */
function agruparRelatos(registros: AlertaTerritorial[]): Grupo[] {
  const ordenados = registros.filter(pontoValido)
    .slice().sort((a, b) => (a.criadoEm! - b.criadoEm!) || a.id.localeCompare(b.id));
  const grupos: Grupo[] = [];

  for (const relato of ordenados) {
    let escolhido: Grupo | null = null;
    let menorDistancia = Infinity;
    for (const grupo of grupos) {
      const referencia = grupo.relatos[0];
      const diferenca = relato.criadoEm! - grupo.primeiro;
      if (diferenca > INTERVALO_MS || diferenca < 0) continue;
      const distancia = distanciaKm(referencia, relato);
      if (distancia <= RAIO_KM && distancia < menorDistancia) {
        escolhido = grupo;
        menorDistancia = distancia;
      }
    }
    if (escolhido) {
      escolhido.relatos.push(relato);
      escolhido.ultimo = relato.criadoEm!;
      escolhido.distanciaMaxima = Math.max(escolhido.distanciaMaxima, menorDistancia);
    } else {
      grupos.push({
        id: relato.id,
        relatos: [relato],
        primeiro: relato.criadoEm!,
        ultimo: relato.criadoEm!,
        latitude: relato.latitude,
        longitude: relato.longitude,
        distanciaMaxima: 0
      });
    }
  }
  return grupos.filter(grupo => grupo.relatos.length >= 2)
    .sort((a, b) => b.ultimo - a.ultimo);
}

/**
 * Amostra a meteorologia por hora em um ponto de referência do grupo,
 * entre 1 h antes do primeiro relato e 1 h depois do último.
 * Não são medições em cada rua nem prova da causa da interrupção.
 */
async function consultarClimaEntorno(
  grupo: Grupo, agora: number, signal: AbortSignal
): Promise<ClimaEntorno> {
  const inicio = Math.floor(grupo.primeiro / HORA) * HORA - HORA;
  // Nunca incluir horas futuras na análise de ocorrências já registradas.
  const fim = Math.min(
    Math.floor(grupo.ultimo / HORA) * HORA + HORA,
    Math.floor(agora / HORA) * HORA
  );
  if (inicio > agora || fim < inicio) throw new Error('Intervalo inválido para consulta meteorológica.');

  const diaLocal = (instante: number) =>
    new Date(instante - 3 * HORA).toISOString().slice(0, 10);
  // Dados de previsão recente só são consultados quando toda a janela cabe
  // no intervalo passado disponível. Para o restante, usa-se o arquivo histórico.
  const recente = inicio >= agora - 6 * DIA;
  const endpoint = recente
    ? 'https://api.open-meteo.com/v1/forecast'
    : 'https://archive-api.open-meteo.com/v1/archive';
  const parametros = new URLSearchParams({
    latitude: String(Number(grupo.latitude.toFixed(4))),
    longitude: String(Number(grupo.longitude.toFixed(4))),
    hourly: 'precipitation,wind_gusts_10m',
    timezone: 'America/Fortaleza'
  });
  if (recente) {
    parametros.set('past_days', '7');
    parametros.set('forecast_days', '1');
  } else {
    parametros.set('start_date', diaLocal(inicio));
    parametros.set('end_date', diaLocal(fim));
  }

  const resposta = await consultarOpenMeteoComCache(
    `${endpoint}?${parametros.toString()}`, signal
  );
  const horarios = (resposta as { hourly?: {
    time?: unknown; precipitation?: unknown; wind_gusts_10m?: unknown
  } }).hourly;
  if (!horarios || !Array.isArray(horarios.time)) {
    throw new Error('Dados meteorológicos horários não disponíveis para este intervalo.');
  }
  const chuva: number[] = [];
  const rajadas: number[] = [];
  let horariosValidos = 0;
  const inicioLocal = new Date(inicio - 3 * HORA).toISOString().slice(0, 13);
  const fimLocal = new Date(fim - 3 * HORA).toISOString().slice(0, 13);
  horarios.time.forEach((hora: unknown, indice: number) => {
    if (typeof hora !== 'string') return;
    const horaConsulta = hora.slice(0, 13);
    if (horaConsulta < inicioLocal || horaConsulta > fimLocal) return;
    const p = Array.isArray(horarios.precipitation) ? horarios.precipitation[indice] : null;
    const v = Array.isArray(horarios.wind_gusts_10m) ? horarios.wind_gusts_10m[indice] : null;
    const temChuva = typeof p === 'number' && Number.isFinite(p);
    const temVento = typeof v === 'number' && Number.isFinite(v);
    if (temChuva || temVento) horariosValidos += 1;
    if (temChuva) chuva.push(p as number);
    if (temVento) rajadas.push(v as number);
  });
  if (chuva.length === 0 && rajadas.length === 0) {
    throw new Error('Sem valores de chuva ou rajadas para o período.');
  }
  return {
    chuvaAcumulada: chuva.length ? chuva.reduce((soma, valor) => soma + valor, 0) : null,
    maiorRajada: rajadas.length ? Math.max(...rajadas) : null,
    horariosValidos,
    inicio,
    fim
  };
}

export default function EnergiaProximidade({ registros, agora }: Props) {
  const grupos = useMemo(() => agruparRelatos(registros), [registros]);
  const registrosEmGrupos = grupos.reduce((total, grupo) => total + grupo.relatos.length, 0);
  const [idSelecionado, setIdSelecionado] = useState<string | null>(null);
  const [clima, setClima] = useState<ClimaEntorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const selecionado = grupos.find(grupo => grupo.id === idSelecionado) ?? null;

  useEffect(() => {
    if (!selecionado) return;
    const controller = new AbortController();
    setCarregando(true);
    setClima(null);
    setErro(null);
    void consultarClimaEntorno(selecionado, agora, controller.signal)
      .then(dados => { if (!controller.signal.aborted) setClima(dados); })
      .catch(falha => {
        if (!controller.signal.aborted)
          setErro(falha instanceof Error ? falha.message : 'Consulta indisponível.');
      })
      .finally(() => { if (!controller.signal.aborted) setCarregando(false); });
    return () => controller.abort();
  }, [selecionado?.id, selecionado?.primeiro, selecionado?.ultimo,
    selecionado?.latitude, selecionado?.longitude]);

  return (
    <div className="energia-proximidade">
      <div className="energia-proximidade__cabecalho">
        <h3><FiMapPin size={15} aria-hidden="true" /> Relatos próximos no espaço e no tempo</h3>
        <span>{grupos.length} grupo(s) · {registrosEmGrupos} relato(s) agrupado(s)</span>
      </div>
      <p className="energia-proximidade__criterio">
        Agrupamento exploratório: até 3 km e até 3 horas do primeiro relato de cada grupo.
        Não representa uma interrupção confirmada da rede elétrica.
      </p>
      {grupos.length ? (
        <div className="energia-proximidade__grupos">
          {grupos.slice(0, 6).map((grupo, indice) => (
            <button key={grupo.id} type="button"
              aria-pressed={idSelecionado === grupo.id}
              onClick={() => setIdSelecionado(atual => atual === grupo.id ? null : grupo.id)}>
              <strong>Grupo {indice + 1} <span>· {grupo.relatos.length} relatos</span></strong>
              <small>{formatoData(grupo.primeiro)} – {formatoData(grupo.ultimo)}</small>
              <span>Até {formatoNumero(grupo.distanciaMaxima)} km do primeiro relato</span>
              <small>Tipos: {[...new Set(grupo.relatos.flatMap(subcategoriasDoAlerta))].join(' · ')}</small>
              <em>{idSelecionado === grupo.id ? 'Ocultar análise' : 'Analisar chuva e vento'}</em>
            </button>
          ))}
        </div>
      ) : (
        <p className="energia-proximidade__sem-grupos">
          Nenhum conjunto de dois ou mais relatos atende aos critérios neste período.
        </p>
      )}
      {grupos.length > 6 && (
        <small className="energia-proximidade__limite">
          Exibindo os 6 grupos mais recentes de {grupos.length}.
        </small>
      )}
      {selecionado && (
        <div className="energia-proximidade__resultado" aria-live="polite">
          <strong>Contexto do grupo · ponto aproximado do primeiro relato</strong>
          {carregando ? <p>Consultando a Open-Meteo…</p> :
            erro ? <p>{erro}</p> :
            clima ? (
              <>
                <div className="energia-proximidade__meteorologia">
                  <span><FiCloudRain aria-hidden="true" />
                    Chuva acumulada estimada: <b>{clima.chuvaAcumulada === null
                      ? 'indisponível' : `${formatoNumero(clima.chuvaAcumulada)} mm`}</b>
                  </span>
                  <span><FiWind aria-hidden="true" />
                    Maior rajada horária estimada: <b>{clima.maiorRajada === null
                      ? 'indisponível' : `${formatoNumero(clima.maiorRajada)} km/h`}</b>
                  </span>
                </div>
                <small>Janela consultada: {formatoData(clima.inicio)} a {formatoData(clima.fim)}
                  {' · '}{clima.horariosValidos} hora(s) com dados horários.</small>
              </>
            ) : null}
          <small>Fonte: Open-Meteo (modelo meteorológico). Valores de um ponto de referência,
            não medições em cada alerta. Proximidade e coincidência temporal não demonstram
            que a chuva ou o vento causaram a interrupção.</small>
        </div>
      )}
    </div>
  );
}
