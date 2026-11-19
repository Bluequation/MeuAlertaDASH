import { useEffect, useMemo, useState } from 'react';
import { FiChevronDown, FiCloudRain, FiMapPin, FiWind } from 'react-icons/fi';
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
  const [grupoAberto, setGrupoAberto] = useState<string | null>(null);
  const [climaAberto, setClimaAberto] = useState<string | null>(null);
  const [clima, setClima] = useState<ClimaEntorno | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [carregando, setCarregando] = useState(false);
  const selecionado = grupos.find(grupo =>
    grupo.id === grupoAberto && grupo.id === climaAberto
  ) ?? null;

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
    <section className="energia-proximidade" aria-label="Relatos de energia próximos">
      <div className="energia-proximidade__cabecalho">
        <h3><FiMapPin size={15} aria-hidden="true" /> Onde houve vários relatos?</h3>
        <span>{grupos.length} {grupos.length === 1 ? 'conjunto encontrado' : 'conjuntos encontrados'}</span>
      </div>
      <p className="energia-proximidade__orientacao">
        Toque em um conjunto para ver o que foi informado.
      </p>
      {grupos.length ? (
        <div className="energia-proximidade__grupos">
          {grupos.slice(0, 6).map((grupo, indice) => {
            const aberto = grupoAberto === grupo.id;
            const exibeClima = aberto && climaAberto === grupo.id;
            const duracaoMinutos = Math.round((grupo.ultimo - grupo.primeiro) / 60_000);
            const distanciaMetros = Math.round(grupo.distanciaMaxima * 1000);
            const tipos = [...new Set(grupo.relatos.flatMap(subcategoriasDoAlerta))];
            return (
              <div className="energia-proximidade__grupo" key={grupo.id}>
                <button type="button" className="energia-proximidade__linha"
                  aria-expanded={aberto}
                  onClick={() => {
                    setGrupoAberto(atual => atual === grupo.id ? null : grupo.id);
                    setClimaAberto(null);
                    setClima(null);
                    setErro(null);
                  }}>
                  <strong>{grupo.relatos.length} relatos próximos
                    <small> · Conjunto {indice + 1}</small>
                  </strong>
                  <span>{formatoData(grupo.primeiro)}
                    {grupo.ultimo !== grupo.primeiro &&
                      ` a ${new Date(grupo.ultimo).toLocaleTimeString('pt-BR', {
                        hour: '2-digit', minute: '2-digit', timeZone: 'America/Fortaleza'
                      })}`}
                  </span>
                  <FiChevronDown className="energia-proximidade__seta" aria-hidden="true" />
                </button>
                {aberto && (
                  <div className="energia-proximidade__detalhes">
                    <p>Relatos a até {distanciaMetros >= 1000
                      ? `${formatoNumero(distanciaMetros / 1000)} km`
                      : `${distanciaMetros} m`} do primeiro registro,
                      em {duracaoMinutos === 0 ? 'menos de 1 minuto' :
                        `${duracaoMinutos} ${duracaoMinutos === 1 ? 'minuto' : 'minutos'}`}.
                    </p>
                    <div className="energia-proximidade__tipos"
                      aria-label="Situações relatadas">
                      {tipos.map(tipo => <span key={tipo}>{tipo}</span>)}
                    </div>
                    <button type="button" className="energia-proximidade__botao-clima"
                      aria-expanded={exibeClima}
                      onClick={() => setClimaAberto(atual => atual === grupo.id ? null : grupo.id)}>
                      {exibeClima ? 'Ocultar chuva e vento' : 'Ver chuva e vento naquele horário'}
                    </button>
                    {exibeClima && (
                      <div className="energia-proximidade__resultado" aria-live="polite">
                        {carregando ? <p>Buscando estimativas da Open-Meteo…</p> :
                          erro ? <p>{erro}</p> :
                          clima ? (
                            <>
                              <div className="energia-proximidade__meteorologia">
                                <span><FiCloudRain aria-hidden="true" />
                                  Chuva: <b>{clima.chuvaAcumulada === null ? 'sem dados' :
                                    `${formatoNumero(clima.chuvaAcumulada)} mm`}</b>
                                </span>
                                <span><FiWind aria-hidden="true" />
                                  Maior rajada: <b>{clima.maiorRajada === null ? 'sem dados' :
                                    `${formatoNumero(clima.maiorRajada)} km/h`}</b>
                                </span>
                              </div>
                              <small>Estimativas de um ponto próximo, entre {
                                formatoData(clima.inicio)} e {formatoData(clima.fim)}.</small>
                            </>
                          ) : null}
                        <small>Fonte: Open-Meteo. Chuva e vento não comprovam
                          a causa da falta de energia.</small>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <p className="energia-proximidade__sem-grupos">
          Não foram encontrados relatos próximos uns dos outros neste período.
        </p>
      )}
      {grupos.length > 6 && (
        <small className="energia-proximidade__limite">
          Mostrando os seis conjuntos mais recentes.
        </small>
      )}
      <details className="energia-proximidade__metodo">
        <summary>Como esses conjuntos são identificados?</summary>
        <p>O painel aproxima relatos feitos a até 3 km e até 3 horas do
          primeiro registro de cada conjunto. Isso ajuda a investigar
          ocorrências, mas não comprova uma única falha na rede elétrica
          nem sua causa.</p>
      </details>
    </section>
  );
}
