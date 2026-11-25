import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  MapContainer,
  TileLayer,
  CircleMarker,
  Popup
} from 'react-leaflet';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from 'recharts';
import {
  FiActivity,
  FiAlertCircle,
  FiCalendar,
  FiCheckCircle,
  FiCloud,
  FiDatabase,
  FiDownload,
  FiDroplet,
  FiExternalLink,
  FiFileText,
  FiInfo,
  FiLayers,
  FiMapPin,
  FiRadio,
  FiRefreshCw,
  FiGlobe,
  FiSun,
  FiUpload
} from 'react-icons/fi';
import {
  importarSerieSuperficie,
  RESERVATORIO_PILOTO,
  type CenaSuperficie
} from './aguaDados';
import {
  consultarMeteorologiaReservatorio,
  type RespostaOpenMeteo
} from './aguaMeteorologia';
import { LEITURA_OFICIAL_SAO_JOSE_III } from './aguaOficial';
import 'leaflet/dist/leaflet.css';
import './agua.css';

type AbaAgua =
  | 'visao'
  | 'reservatorio'
  | 'satelite'
  | 'evaporacao'
  | 'meteorologia'
  | 'relatorios';

type AgrupamentoSerie = 'diario' | 'mensal' | 'anual';
type FiltroSatelite = 'Sentinel-2' | 'Landsat' | 'MapBiomas Água';

const ABAS: { id: AbaAgua; nome: string; icone: ReactNode }[] = [
  { id: 'visao', nome: 'Visão geral', icone: <FiActivity /> },
  { id: 'reservatorio', nome: 'Reservatório', icone: <FiDroplet /> },
  { id: 'satelite', nome: 'Satélite', icone: <FiGlobe /> },
  { id: 'evaporacao', nome: 'Evaporação', icone: <FiSun /> },
  { id: 'meteorologia', nome: 'Meteorologia', icone: <FiCloud /> },
  { id: 'relatorios', nome: 'Relatórios', icone: <FiFileText /> }
];

// O painel lê automaticamente uma série oficial processada, quando publicada.
 // Importações locais são preservadas no navegador para não refazer o trabalho.
const CHAVE_SERIE_LOCAL = 'cuidai:agua:sao-jose-iii:serie:v1';
const CSV_MAPBIOMAS_PUBLICADO = 'data/cuidai-agua-sao-jose-iii-mapbiomas.csv';

function combinarSeries(atual: CenaSuperficie[], entrada: CenaSuperficie[]): CenaSuperficie[] {
  const porChave = new Map<string, CenaSuperficie>();
  for (const cena of [...atual, ...entrada]) {
    const chave = [cena.satelite, cena.data, cena.cenaId || cena.id].join('|');
    porChave.set(chave, cena);
  }
  return [...porChave.values()].sort((a, b) => a.data.localeCompare(b.data));
}

function formatarNumero(valor: number | null | undefined, casas = 1): string {
  if (valor === null || valor === undefined || !Number.isFinite(valor)) return '—';
  return valor.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas
  });
}

function formatarData(data: string): string {
  const partes = data.slice(0, 10).split('-');
  if (partes.length !== 3) return data;
  return partes[2] + '/' + partes[1] + '/' + partes[0];
}

function rotuloCena(cena: CenaSuperficie): string {
  return cena.satelite === 'MapBiomas Água'
    ? 'Ano ' + cena.data.slice(0, 4)
    : formatarData(cena.data);
}

function exportarCSV(cenas: CenaSuperficie[]): void {
  const cabecalho = [
    'data',
    'area_ha',
    'satellite',
    'cloud_pct',
    'valid_coverage_pct',
    'ndwi_threshold',
    'scale_m',
    'scene_id',
    'preview_url'
  ];
  const linhas = cenas.map(cena => [
    cena.data,
    String(cena.areaHa).replace('.', ','),
    cena.satelite,
    cena.nuvensPct === null ? '' : String(cena.nuvensPct).replace('.', ','),
    cena.coberturaValidaPct === null ? '' : String(cena.coberturaValidaPct).replace('.', ','),
    cena.limiarNdwi === null ? '' : String(cena.limiarNdwi).replace('.', ','),
    cena.resolucaoM === null ? '' : String(cena.resolucaoM),
    cena.cenaId || '',
    cena.previewUrl || ''
  ]);

  const escapar = (valor: string) =>
    '"' + valor.replace(/"/g, '""') + '"';

  const conteudo = '\uFEFF' + [cabecalho, ...linhas]
    .map(linha => linha.map(escapar).join(';'))
    .join('\r\n');

  const arquivo = new Blob([conteudo], {
    type: 'text/csv;charset=utf-8;'
  });
  const url = URL.createObjectURL(arquivo);
  const link = document.createElement('a');
  link.href = url;
  link.download = 'cuidai-agua-sao-jose-iii-serie-superficial.csv';
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function Indicador({
  titulo,
  valor,
  unidade,
  nota,
  tom = 'azul'
}: {
  titulo: string;
  valor: string;
  unidade?: string;
  nota: string;
  tom?: 'azul' | 'neutro' | 'laranja';
}) {
  return (
    <article className="agua-indicador">
      <span className="agua-indicador__titulo">{titulo}</span>
      <div className={'agua-indicador__valor agua-indicador__valor--' + tom}>
        {valor}
        {unidade && <small>{unidade}</small>}
      </div>
      <span className="agua-indicador__nota">{nota}</span>
    </article>
  );
}

function TituloSecao({
  titulo,
  descricao,
  acao
}: {
  titulo: string;
  descricao: string;
  acao?: ReactNode;
}) {
  return (
    <div className="agua-secao-titulo">
      <div>
        <h2>{titulo}</h2>
        <p>{descricao}</p>
      </div>
      {acao}
    </div>
  );
}

export default function AguaObservatorio() {
  const [aba, setAba] = useState<AbaAgua>('visao');
  const [meteorologia, setMeteorologia] = useState<RespostaOpenMeteo | null>(null);
  const [carregandoMeteo, setCarregandoMeteo] = useState(true);
  const [erroMeteo, setErroMeteo] = useState<string | null>(null);
  const [atualizacaoMeteo, setAtualizacaoMeteo] = useState<string | null>(null);
  const [solicitarAtualizacao, setSolicitarAtualizacao] = useState(0);

  const [cenas, setCenas] = useState<CenaSuperficie[]>([]);
  const [seriePublicada, setSeriePublicada] = useState(false);
  const [mensagemImportacao, setMensagemImportacao] = useState<string | null>(null);
  const [cenaAId, setCenaAId] = useState('');
  const [cenaBId, setCenaBId] = useState('');
  const [agrupamento, setAgrupamento] = useState<AgrupamentoSerie>('mensal');
  const [filtroSatelite, setFiltroSatelite] = useState<FiltroSatelite>('Sentinel-2');

  const [areaHa, setAreaHa] = useState('');
  const [evaporacaoMm, setEvaporacaoMm] = useState('');
  const [dias, setDias] = useState('1');

  useEffect(() => {
    let ativo = true;

    try {
      const salvo = window.localStorage.getItem(CHAVE_SERIE_LOCAL);
      if (salvo) {
        const seriesSalvas = importarSerieSuperficie(salvo);
        setCenas(seriesSalvas);
        setFiltroSatelite(seriesSalvas[0].satelite);
        setMensagemImportacao('Série anterior recuperada deste navegador.');
      }
    } catch {
      // Navegadores podem bloquear localStorage. A página continua funcional.
    }

    const base = import.meta.env.BASE_URL;
    const url = base + CSV_MAPBIOMAS_PUBLICADO;
    void fetch(url, { cache: 'no-store' }).then(async resposta => {
      if (!resposta.ok) return null;
      const conteudo = await resposta.text();
      return importarSerieSuperficie(conteudo);
    }).then(importadas => {
      if (!ativo || !importadas?.length) return;
      setCenas(anteriores => combinarSeries(anteriores, importadas));
      setSeriePublicada(true);
      setCenaAId(anterior => anterior || importadas[0].id);
      setCenaBId(anterior => anterior || importadas[importadas.length - 1].id);
      setFiltroSatelite('MapBiomas Água');
      setAgrupamento('anual');
    }).catch(() => {
      // Ainda não há exportação histórica publicada. Nunca inventar área.
    });

    return () => { ativo = false; };
  }, []);

  useEffect(() => {
    const controlador = new AbortController();
    let ativo = true;

    async function carregar() {
      try {
        const dados = await consultarMeteorologiaReservatorio(controlador.signal);
        if (!ativo) return;
        setMeteorologia(dados);
        setAtualizacaoMeteo(new Date().toISOString());
      } catch (erro) {
        if (!ativo || controlador.signal.aborted) return;
        setErroMeteo(
          erro instanceof Error
            ? erro.message
            : 'Não foi possível carregar os dados meteorológicos.'
        );
      } finally {
        if (ativo) setCarregandoMeteo(false);
      }
    }

    void carregar();
    return () => {
      ativo = false;
      controlador.abort();
    };
  }, [solicitarAtualizacao]);

  const serieMeteorologica = useMemo(() => {
    const horarios = meteorologia?.hourly?.time || [];
    const temperaturas = meteorologia?.hourly?.temperature_2m || [];
    const chuvas = meteorologia?.hourly?.precipitation || [];
    const agora = Date.now();

    return horarios
      .map((horario, indice) => ({
        horario,
        temperatura: temperaturas[indice],
        chuva: chuvas[indice]
      }))
      .filter(item => {
        const instante = new Date(item.horario).getTime();
        return Number.isFinite(instante) &&
          instante >= agora - 24 * 60 * 60 * 1000 &&
          instante <= agora;
      })
      .map(item => ({
        horario: item.horario.slice(11, 16),
        temperatura: item.temperatura,
        chuva: item.chuva
      }));
  }, [meteorologia]);

  const cenasFiltradas = useMemo(
    () => cenas.filter(cena => cena.satelite === filtroSatelite),
    [cenas, filtroSatelite]
  );

  const serieSuperficial = useMemo(() => {
    const grupos = new Map<string, number[]>();

    cenasFiltradas.forEach(cena => {
      const chave = agrupamento === 'diario'
        ? cena.data
        : agrupamento === 'mensal'
          ? cena.data.slice(0, 7)
          : cena.data.slice(0, 4);

      const valores = grupos.get(chave) || [];
      valores.push(cena.areaHa);
      grupos.set(chave, valores);
    });

    return Array.from(grupos.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([periodo, valores]) => {
        const ordenados = [...valores].sort((a, b) => a - b);
        const meio = Math.floor(ordenados.length / 2);
        const mediana = ordenados.length % 2
          ? ordenados[meio]
          : (ordenados[meio - 1] + ordenados[meio]) / 2;

        return {
          periodo,
          areaHa: mediana,
          cenas: valores.length
        };
      });
  }, [cenasFiltradas, agrupamento]);

  const destaquesAnuais = useMemo(() => {
    if (filtroSatelite !== 'MapBiomas Água' || !serieSuperficial.length) return null;
    const ordenados = [...serieSuperficial].sort((a, b) => a.areaHa - b.areaHa);
    return {
      menor: ordenados[0],
      maior: ordenados[ordenados.length - 1],
      recente: serieSuperficial[serieSuperficial.length - 1]
    };
  }, [serieSuperficial, filtroSatelite]);

  const cenaMaisRecente = cenas.length
    ? [...cenas].sort((a, b) => b.data.localeCompare(a.data))[0]
    : null;

  const cenaA = cenas.find(cena => cena.id === cenaAId) || null;
  const cenaB = cenas.find(cena => cena.id === cenaBId) || null;
  const diferencaArea = cenaA && cenaB
    ? cenaB.areaHa - cenaA.areaHa
    : null;
  const variacaoPercentual = cenaA && cenaB && cenaA.areaHa > 0
    ? (diferencaArea! / cenaA.areaHa) * 100
    : null;

  const areaNumerica = Number(areaHa.replace(',', '.'));
  const evaporacaoNumerica = Number(evaporacaoMm.replace(',', '.'));
  const diasNumerico = Number(dias.replace(',', '.'));
  const perdaDiariaM3 = areaHa.trim() !== '' && evaporacaoMm.trim() !== '' &&
    areaNumerica > 0 && evaporacaoNumerica >= 0
    ? areaNumerica * evaporacaoNumerica * 10
    : null;
  const perdaPeriodoM3 = perdaDiariaM3 !== null && diasNumerico > 0
    ? perdaDiariaM3 * diasNumerico
    : null;

  async function importarArquivo(arquivo: File | undefined) {
    if (!arquivo) return;

    try {
      const conteudo = await arquivo.text();
      const importadas = importarSerieSuperficie(conteudo);
      setCenas(anteriores => combinarSeries(anteriores, importadas));
      setCenaAId(importadas[0].id);
      setCenaBId(importadas[importadas.length - 1].id);
      setFiltroSatelite(importadas[0].satelite);
      if (importadas[0].satelite === 'MapBiomas Água') {
        setAgrupamento('anual');
      }
      try {
        window.localStorage.setItem(CHAVE_SERIE_LOCAL, conteudo);
        setMensagemImportacao(
          importadas.length + ' registros importados e preservados neste navegador. Confira a fonte e a geometria.'
        );
      } catch {
        setMensagemImportacao(
          importadas.length + ' registros importados nesta sessão. O navegador não permitiu a persistência local.'
        );
      }

      const ultima = importadas[importadas.length - 1];
      if (ultima.satelite !== 'MapBiomas Água') {
        setAreaHa(String(ultima.areaHa).replace('.', ','));
      }
    } catch (erro) {
      setMensagemImportacao(
        erro instanceof Error ? erro.message : 'Não foi possível interpretar o arquivo.'
      );
    }
  }

  function imprimirRelatorio() {
    window.print();
  }

  const current = meteorologia?.current;

  return (
    <main className="agua-page">
      <header className="agua-header">
        <div className="agua-header__identidade">
          <div className="agua-kicker"><FiDroplet /> OBSERVATÓRIO HÍDRICO MUNICIPAL</div>
          <h1>CUIDAÍ <span>| Água</span></h1>
          <p>Monitoramento dos reservatórios e apoio à gestão hídrica de Ipaporanga.</p>
        </div>
        <div className="agua-header__acoes agua-no-print">
          <span className="agua-tag agua-tag--piloto">PILOTO · SÃO JOSÉ III</span>
          <button
            className="agua-botao agua-botao--secundario"
            onClick={() => {
              setCarregandoMeteo(true);
              setErroMeteo(null);
              setSolicitarAtualizacao(valor => valor + 1);
            }}
            disabled={carregandoMeteo}
          >
            <FiRefreshCw className={carregandoMeteo ? 'agua-girando' : ''} />
            Atualizar meteorologia
          </button>
        </div>
      </header>

      <nav className="agua-abas agua-no-print" aria-label="Módulos do Observatório Hídrico">
        {ABAS.map(item => (
          <button
            key={item.id}
            className={'agua-aba' + (aba === item.id ? ' agua-aba--ativa' : '')}
            onClick={() => setAba(item.id)}
            aria-current={aba === item.id ? 'page' : undefined}
          >
            {item.icone}
            <span>{item.nome}</span>
          </button>
        ))}
      </nav>

      <div className="agua-conteudo">
        {aba === 'visao' && (
          <>
            <TituloSecao
              titulo={RESERVATORIO_PILOTO.nome}
              descricao="Ipaporanga · Sertões de Crateús · Riacho São José"
              acao={<span className="agua-fonte"><FiDatabase /> Cadastro técnico COGERH</span>}
            />

            <section className="agua-indicadores">
              <Indicador titulo="Capacidade oficial" valor="9,12" unidade="hm³" nota="Ficha técnica da COGERH" tom="azul" />
              <Indicador titulo="Volume armazenado" valor={formatarNumero(LEITURA_OFICIAL_SAO_JOSE_III.volumeHm3, 2)} unidade="hm³" nota={'COGERH · ' + formatarData(LEITURA_OFICIAL_SAO_JOSE_III.data) + ' · ' + formatarNumero(LEITURA_OFICIAL_SAO_JOSE_III.percentual, 2) + '% (histórico)'} tom="azul" />
              <Indicador titulo="Área superficial" valor={formatarNumero(cenaMaisRecente?.areaHa, 2)} unidade="ha" nota={cenaMaisRecente ? (cenaMaisRecente.satelite === 'MapBiomas Água' ? 'MapBiomas Água · ano ' + cenaMaisRecente.data.slice(0, 4) + ' · classe anual (não é data de imagem)' : cenaMaisRecente.satelite + ' · ' + formatarData(cenaMaisRecente.data) + ' (classificação)') : 'Aguardando série do reservatório'} tom="neutro" />
              <Indicador titulo="Perda por evaporação" valor="—" unidade="m³/dia" nota="Aguardando estimativa validada" tom="laranja" />
            </section>

            <section className="agua-grade-visao">
              <article className="agua-painel agua-painel--mapa">
                <div className="agua-painel__cabecalho">
                  <div>
                    <h3>Localização do reservatório</h3>
                    <p>Ponto de referência geográfica do Açude São José III</p>
                  </div>
                  <span className="agua-mini-status"><FiMapPin /> Ipaporanga · CE</span>
                </div>
                <div className="agua-mapa">
                  <MapContainer
                    center={[RESERVATORIO_PILOTO.latitude, RESERVATORIO_PILOTO.longitude]}
                    zoom={14}
                    scrollWheelZoom={false}
                    style={{ height: '100%', width: '100%' }}
                  >
                    <TileLayer
                      attribution="&copy; OpenStreetMap contributors"
                      url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                    />
                    <CircleMarker
                      center={[RESERVATORIO_PILOTO.latitude, RESERVATORIO_PILOTO.longitude]}
                      radius={9}
                      pathOptions={{
                        color: '#FFFFFF',
                        weight: 3,
                        fillColor: '#168FC4',
                        fillOpacity: 1
                      }}
                    >
                      <Popup>
                        <strong>Açude São José III</strong><br />
                        Ipaporanga · Ceará
                      </Popup>
                    </CircleMarker>
                  </MapContainer>
                </div>
                <div className="agua-mapa-rodape">
                  <span>Coordenadas de referência</span>
                  <strong>-4,8986 · -40,7703</strong>
                </div>
              </article>

              <article className="agua-painel">
                <div className="agua-painel__cabecalho">
                  <div><h3>Situação das fontes</h3><p>Origem e disponibilidade dos dados</p></div>
                </div>
                <div className="agua-lista-fontes">
                  <div className="agua-fonte-linha">
                    <span className="agua-fonte-icone agua-fonte-icone--ok"><FiCheckCircle /></span>
                    <div><strong>COGERH · cadastro e volume</strong><small>Ficha técnica e boletim de 24/11/2026; não é leitura ao vivo</small></div>
                    <span className="agua-status agua-status--ok">Disponível</span>
                  </div>
                  <div className="agua-fonte-linha">
                    <span className="agua-fonte-icone agua-fonte-icone--ok"><FiCloud /></span>
                    <div><strong>Open-Meteo</strong><small>Meteorologia estimada por modelo</small></div>
                    <span className={'agua-status ' + (meteorologia ? 'agua-status--ok' : 'agua-status--pendente')}>
                      {meteorologia ? 'Conectado' : 'Pendente'}
                    </span>
                  </div>
                  <div className="agua-fonte-linha">
                    <span className="agua-fonte-icone"><FiGlobe /></span>
                    <div><strong>Sentinel-2 / Landsat</strong><small>Área superficial por cena processada e validada</small></div>
                    <span className="agua-status agua-status--pendente">
                      {cenas.filter(c => c.satelite === 'Sentinel-2' || c.satelite === 'Landsat').length ? cenas.filter(c => c.satelite === 'Sentinel-2' || c.satelite === 'Landsat').length + ' cenas' : 'Aguardando'}
                    </span>
                  </div>
                  <div className="agua-fonte-linha">
                    <span className="agua-fonte-icone agua-fonte-icone--ok"><FiDatabase /></span>
                    <div><strong>MapBiomas Água · Coleção 5</strong><small>Série do São José III · 1985–2025 · 30 m</small></div>
                    <span className={'agua-status ' + (cenas.some(c => c.satelite === 'MapBiomas Água') ? 'agua-status--ok' : 'agua-status--pendente')}>
                      {cenas.some(c => c.satelite === 'MapBiomas Água') ? 'Série carregada' : 'Sem série'}
                    </span>
                  </div>
                  <div className="agua-fonte-linha">
                    <span className="agua-fonte-icone"><FiRadio /></span>
                    <div><strong>Estação meteorológica</strong><small>Integração preparada para implantação</small></div>
                    <span className="agua-status agua-status--pendente">Não instalada</span>
                  </div>
                </div>
                <div className="agua-aviso">
                  <FiAlertCircle />
                  <p>O volume acima é uma leitura oficial histórica, não o valor em tempo real. Indicadores sem valor permanecem indisponíveis até haver análise validada. <a href={LEITURA_OFICIAL_SAO_JOSE_III.pagina} target="_blank" rel="noreferrer">Consultar situação atual na COGERH <FiExternalLink /></a></p>
                </div>
              </article>
            </section>
          </>
        )}

        {aba === 'reservatorio' && (
          <>
            <TituloSecao
              titulo="Ficha do reservatório"
              descricao="Características técnicas cadastradas para o reservatório piloto."
            />
            <section className="agua-ficha-grade">
              <div className="agua-ficha-destaque">
                <span>Capacidade de acumulação informada pela COGERH</span>
                <strong>9,12 <small>hm³</small></strong>
                <p>Equivalente a 9,12 bilhões de litros, considerando a capacidade nominal informada na ficha técnica.</p>
                <a href={RESERVATORIO_PILOTO.fonteFicha} target="_blank" rel="noreferrer">
                  Consultar ficha técnica <FiExternalLink />
                </a>
              </div>
              <div className="agua-painel agua-ficha-dados">
                <div><span>Município</span><strong>Ipaporanga · CE</strong></div>
                <div><span>Sistema hídrico</span><strong>Sertões de Crateús</strong></div>
                <div><span>Rio / riacho barrado</span><strong>Riacho São José</strong></div>
                <div><span>Área da bacia hidrográfica</span><strong>99,35 km²</strong></div>
                <div><span>Cota do sangradouro</span><strong>100,00 m</strong></div>
                <div><span>Largura do sangradouro</span><strong>37,90 m</strong></div>
                <div><span>Latitude de referência</span><strong>-4,8986</strong></div>
                <div><span>Longitude de referência</span><strong>-40,7703</strong></div>
              </div>
            </section>
            <div className="agua-nota-fonte">
              <FiDatabase />
              <p>Registro oficial de {formatarData(LEITURA_OFICIAL_SAO_JOSE_III.data)}: cota {formatarNumero(LEITURA_OFICIAL_SAO_JOSE_III.cotaM, 2)} m; volume {formatarNumero(LEITURA_OFICIAL_SAO_JOSE_III.volumeHm3, 2)} hm³; {formatarNumero(LEITURA_OFICIAL_SAO_JOSE_III.percentual, 2)}% da capacidade de referência. Fotografia histórica do boletim, não atualização em tempo real.</p>
              <a href={LEITURA_OFICIAL_SAO_JOSE_III.pagina} target="_blank" rel="noreferrer">Abrir boletim COGERH <FiExternalLink /></a>
            </div>

            <div className="agua-nota-fonte">
              <FiInfo />
              <p>As coordenadas são de referência do posto do reservatório no documento de planejamento hídrico. A delimitação precisa do espelho d’água será validada com cartografia e imagens de satélite.</p>
              <a href={RESERVATORIO_PILOTO.fonteCoordenadas} target="_blank" rel="noreferrer">Fonte das coordenadas <FiExternalLink /></a>
            </div>

            <div className="agua-nota-fonte agua-nota-fonte--atencao">
              <FiAlertCircle />
              <p>A ficha técnica consultada da COGERH informa 9,12 hm³. Uma publicação acadêmica anterior registra 7,96 hm³. Antes de calcular volume armazenado ou balanço hídrico, a capacidade e a curva cota-área-volume vigentes precisam ser confirmadas com a COGERH.</p>
              <a href="https://repositorio.ufc.br/bitstream/riufc/65666/1/2022_tcc_wasousa.pdf" target="_blank" rel="noreferrer">Consultar referência acadêmica anterior <FiExternalLink /></a>
            </div>
          </>
        )}

        {aba === 'satelite' && (
          <>
            <TituloSecao
              titulo="Monitoramento por satélite"
              descricao="Série histórica da área superficial identificada em cenas válidas."
              acao={
                <label className="agua-botao agua-botao--primario agua-no-print">
                  <FiUpload /> Importar série CSV
                  <input
                    type="file"
                    accept=".csv,text/csv"
                    onChange={event => {
                      void importarArquivo(event.target.files?.[0]);
                      event.target.value = '';
                    }}
                  />
                </label>
              }
            />

            <div className="agua-satelite-fontes">
              <div><FiGlobe /><span><strong>Sentinel-2</strong><small>Fonte principal · resolução de 10 m nas bandas usadas no NDWI</small></span></div>
              <div><FiLayers /><span><strong>Landsat 8/9</strong><small>Complemento histórico · resolução de 30 m nas bandas usadas no NDWI</small></span></div>
              <div><FiDatabase /><span><strong>MapBiomas Água · Coleção 5</strong><small>Classificação anual 1985–2025 · 30 m · fonte pública</small></span></div>
            </div>
            <details className="agua-metodologia">
              <summary><FiInfo /> Como interpretar os dados e suas limitações {seriePublicada && <span>· Série MapBiomas carregada</span>}</summary>
              <p>MapBiomas Água, Coleção 5 (1985–2025; 30 m): na Caatinga, a classe anual considera água detectada em pelo menos seis meses. O valor representa a área classificada como água dentro do polígono original de 411 vértices. Ausência de pixels classificados não comprova seca; a geometria pode deixar de fora água de cheias históricas. A data de 31/12 indica o ano de referência, não uma imagem daquele dia. A série não mede volume nem nível. Sentinel-2 e Landsat são análises por cena, com outros métodos e resoluções. <a href="https://brasil.mapbiomas.org/iniciativas-e-produtos/agua/mapeamento-anual/superficie-de-agua-anual/" target="_blank" rel="noreferrer">Método e fonte MapBiomas <FiExternalLink /></a>.</p>
            </details>

            {mensagemImportacao && (
              <div className="agua-mensagem-importacao"><FiInfo /> {mensagemImportacao}</div>
            )}

            <section className="agua-painel">
              <div className="agua-painel__cabecalho agua-painel__cabecalho--quebra">
                <div>
                  <h3>{filtroSatelite === 'MapBiomas Água' ? 'Evolução anual da água mapeada' : 'Evolução da superfície de água por cena'}</h3>
                  <p>{filtroSatelite === 'MapBiomas Água' ? 'Observações anuais discretas · 1985–2025 · classe de água MapBiomas' : 'Área classificada por imagem válida; mediana quando há mais de uma cena no período.'}</p>
                </div>
                <div className="agua-controles-serie agua-no-print">
                  <select
                    className="agua-seletor"
                    value={filtroSatelite}
                    onChange={event => {
                      const fonte = event.target.value as FiltroSatelite;
                      setFiltroSatelite(fonte);
                      if (fonte === 'MapBiomas Água') setAgrupamento('anual');
                    }}
                    aria-label="Fonte da série"
                  >
                    <option value="Sentinel-2">Sentinel-2 · principal</option>
                    <option value="Landsat">Landsat · por cena</option>
                     <option value="MapBiomas Água">MapBiomas Água · anual 1985–2025</option>
                  </select>
                  <select
                    className="agua-seletor"
                    value={agrupamento}
                  onChange={event => setAgrupamento(event.target.value as AgrupamentoSerie)}
                  aria-label="Agrupamento da série"
                >
                  {filtroSatelite !== 'MapBiomas Água' && <option value="diario">Diário · por aquisição</option>}
                  {filtroSatelite !== 'MapBiomas Água' && <option value="mensal">Mensal · mediana</option>}
                    <option value="anual">{filtroSatelite === 'MapBiomas Água' ? 'Anual · classificação' : 'Anual · mediana'}</option>
                  </select>
                </div>
              </div>

              {serieSuperficial.length > 0 ? (
                <div className="agua-grafico">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={serieSuperficial} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
                      <defs>
                        <linearGradient id="aguaAreaGradient" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#168FC4" stopOpacity={0.24} />
                          <stop offset="95%" stopColor="#168FC4" stopOpacity={0.02} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="#E8EFF5" strokeDasharray="3 4" vertical={false} />
                      <XAxis dataKey="periodo" tick={{ fill: '#8292A3', fontSize: 11 }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fill: '#8292A3', fontSize: 11 }} axisLine={false} tickLine={false} unit=" ha" />
                      <Tooltip
                        formatter={(valor: unknown) => [formatarNumero(Number(valor), 2) + ' ha', filtroSatelite === 'MapBiomas Água' ? 'Água classificada no ano' : 'Área superficial']}
                        labelFormatter={label => (filtroSatelite === 'MapBiomas Água' ? 'Ano: ' : 'Período: ') + label}
                      />
                      <Area
                        type={filtroSatelite === 'MapBiomas Água' ? 'linear' : 'monotone'}
                        dataKey="areaHa"
                        stroke="#168FC4"
                        strokeWidth={2.5}
                        fill="url(#aguaAreaGradient)"
                        dot={filtroSatelite === 'MapBiomas Água' ? { r: 2.5, fill: '#168FC4', strokeWidth: 0 } : false}
                        activeDot={{ r: 5, stroke: '#FFFFFF', strokeWidth: 2 }}
                        connectNulls={false}
                      />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="agua-vazio">
                  <FiGlobe />
                  <strong>{filtroSatelite === 'MapBiomas Água' ? 'Série anual não carregada' : 'Sem dados processados de ' + filtroSatelite}</strong>
                  <p>{filtroSatelite === 'MapBiomas Água'
                    ? 'Não foi possível carregar o CSV público do MapBiomas. Confira a disponibilidade do arquivo.'
                    : 'O seletor está funcionando, mas ainda não existe uma série de cenas calculadas para este sensor. O MapBiomas não substitui medições individuais de ' + filtroSatelite + '. A rotina para gerar os dados reais já está preparada.'}</p>
                  {filtroSatelite !== 'MapBiomas Água' && (
                    <a href="https://github.com/Bluequation/MeuAlertaDASH/blob/feat/cuidai-agua-sao-jose-iii/scripts/earth-engine/05-cenas-sentinel-landsat-2023-2026.js" target="_blank" rel="noreferrer">
                      Ver rotina de processamento dos sensores <FiExternalLink />
                    </a>
                  )}
                </div>
              )}
              {destaquesAnuais && (
                <div className="agua-serie-destaques" aria-label="Destaques históricos do MapBiomas">
                  <div><span>Maior área mapeada</span><strong>{formatarNumero(destaquesAnuais.maior.areaHa, 2)} ha</strong><small>{destaquesAnuais.maior.periodo}</small></div>
                  <div><span>Menor área mapeada</span><strong>{formatarNumero(destaquesAnuais.menor.areaHa, 2)} ha</strong><small>{destaquesAnuais.menor.periodo} · não comprova seca</small></div>
                  <div><span>Último ano disponível</span><strong>{formatarNumero(destaquesAnuais.recente.areaHa, 2)} ha</strong><small>{destaquesAnuais.recente.periodo}</small></div>
                </div>
              )}
              <div className="agua-rodape-grafico">
                <span>{cenasFiltradas.length} registros · {filtroSatelite} · {cenas.length} no total</span>
                <span>{filtroSatelite === 'MapBiomas Água' ? 'Classificação anual · hectares (ha)' : 'Área por cena · hectares (ha)'}</span>
              </div>
            </section>

            <section className="agua-painel">
              <div className="agua-painel__cabecalho">
                <div><h3>Comparador temporal</h3><p>Compare dois registros e observe a variação da área mapeada; diferenças entre fontes exigem cautela.</p></div>
              </div>
              {cenas.length >= 2 ? (
                <>
                  <div className="agua-comparador-controles agua-no-print">
                    <label>{cenaA?.satelite === 'MapBiomas Água' ? 'Ano A' : 'Data A'}
                      <select className="agua-seletor" value={cenaAId} onChange={event => setCenaAId(event.target.value)}>
                        {cenas.map(cena => <option key={cena.id} value={cena.id}>{rotuloCena(cena)} · {cena.satelite}</option>)}
                      </select>
                    </label>
                    <label>{cenaB?.satelite === 'MapBiomas Água' ? 'Ano B' : 'Data B'}
                      <select className="agua-seletor" value={cenaBId} onChange={event => setCenaBId(event.target.value)}>
                        {cenas.map(cena => <option key={cena.id} value={cena.id}>{rotuloCena(cena)} · {cena.satelite}</option>)}
                      </select>
                    </label>
                  </div>
                  <div className="agua-comparador-resultados">
                    <div><span>Área na data A</span><strong>{cenaA ? formatarNumero(cenaA.areaHa, 2) + ' ha' : '—'}</strong></div>
                    <div><span>Área na data B</span><strong>{cenaB ? formatarNumero(cenaB.areaHa, 2) + ' ha' : '—'}</strong></div>
                    <div><span>Variação da área mapeada</span><strong className={diferencaArea !== null && diferencaArea < 0 ? 'agua-valor-negativo' : 'agua-valor-positivo'}>{diferencaArea === null ? '—' : (diferencaArea > 0 ? '+' : '') + formatarNumero(diferencaArea, 2) + ' ha'}</strong></div>
                    <div><span>Variação percentual</span><strong>{variacaoPercentual === null ? '—' : (variacaoPercentual > 0 ? '+' : '') + formatarNumero(variacaoPercentual, 1) + '%'}</strong></div>
                  </div>
                  {cenaA && cenaB && cenaA.satelite !== cenaB.satelite && (
                    <div className="agua-mensagem-importacao">
                      <FiAlertCircle /> A comparação usa sensores diferentes. Sentinel-2 e Landsat têm resoluções espaciais distintas; interprete a diferença com cautela e prefira comparar cenas do mesmo sensor.
                    </div>
                  )}
                  {(cenaA?.coberturaValidaPct !== null && cenaA?.coberturaValidaPct !== undefined && cenaA.coberturaValidaPct < 80) || (cenaB?.coberturaValidaPct !== null && cenaB?.coberturaValidaPct !== undefined && cenaB.coberturaValidaPct < 80) ? (
                    <div className="agua-mensagem-erro"><FiAlertCircle /> Uma das cenas tem menos de 80% de cobertura válida sobre a área de estudo. Revise a máscara de nuvens e a qualidade antes de usar o resultado.</div>
                  ) : null}
                  <div className="agua-comparador-imagens">
                    {[{ cena: cenaA, titulo: 'Data A' }, { cena: cenaB, titulo: 'Data B' }].map(item => (
                      <div className="agua-previa-cena" key={item.titulo}>
                        <div className="agua-previa-cena__topo"><strong>{item.titulo}</strong><span>{item.cena ? rotuloCena(item.cena) : '—'}</span></div>
                        {item.cena?.previewUrl
                          ? <img src={item.cena.previewUrl} alt={'Prévia da cena ' + item.titulo} />
                          : <div className="agua-previa-sem-imagem"><FiGlobe /><span>Prévia não vinculada a esta cena</span></div>}
                        <small>{item.cena ? item.cena.satelite + ' · ' + formatarNumero(item.cena.areaHa, 2) + ' ha · ' + (item.cena.resolucaoM ? item.cena.resolucaoM + ' m' : 'resolução n/i') + (item.cena.satelite === 'MapBiomas Água' ? ' · classe anual de água; cobertura de observação não estimada' : ' · cobertura válida ' + (item.cena.coberturaValidaPct === null ? 'n/i' : formatarNumero(item.cena.coberturaValidaPct, 0) + '%')) + ' · nuvens ' + (item.cena.nuvensPct === null ? 'n/i' : formatarNumero(item.cena.nuvensPct, 0) + '%') + ' · NDWI ' + (item.cena.limiarNdwi === null ? 'n/i' : formatarNumero(item.cena.limiarNdwi, 2)) : 'Selecione uma cena'}</small>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="agua-vazio agua-vazio--compacto">
                  <FiCalendar />
                  <strong>São necessários pelo menos dois registros</strong>
                  <p>Após importar ou publicar uma série com dois períodos, a comparação será habilitada automaticamente.</p>
                </div>
              )}
            </section>
          </>
        )}

        {aba === 'evaporacao' && (
          <>
            <TituloSecao
              titulo="Evaporação e perdas"
              descricao="Conversão da lâmina evaporada em volume de água perdido."
            />
            <section className="agua-evaporacao-grade">
              <article className="agua-painel">
                <div className="agua-painel__cabecalho">
                  <div><h3>Calculadora de perda evaporativa</h3><p>Informe a área inundada e a lâmina de evaporação do período.</p></div>
                </div>
                <div className="agua-formulario">
                  <label>Área superficial (hectares)
                    <input type="number" min="0" step="0.01" value={areaHa} onChange={event => setAreaHa(event.target.value)} placeholder="Ex.: 100,00" />
                  </label>
                  <label>Evaporação (mm/dia)
                    <input type="number" min="0" step="0.1" value={evaporacaoMm} onChange={event => setEvaporacaoMm(event.target.value)} placeholder="Aguardando medição ou modelo" />
                  </label>
                  <label>Duração do período (dias)
                    <input type="number" min="1" step="1" value={dias} onChange={event => setDias(event.target.value)} />
                  </label>
                </div>
                <div className="agua-formula">
                  <strong>Volume evaporado = lâmina (mm) × área (ha) × 10</strong>
                  <span>1 mm de evaporação sobre 1 hectare equivale a 10 m³.</span>
                </div>
                {perdaPeriodoM3 !== null ? (
                  <div className="agua-resultado-evaporacao">
                    <div><span>Perda diária calculada</span><strong>{formatarNumero(perdaDiariaM3, 1)} m³</strong></div>
                    <div><span>Perda no período</span><strong>{formatarNumero(perdaPeriodoM3, 1)} m³</strong></div>
                    <div><span>Equivalente em litros</span><strong>{formatarNumero(perdaPeriodoM3 * 1000, 0)} L</strong></div>
                  </div>
                ) : (
                  <div className="agua-vazio agua-vazio--compacto">
                    <FiDroplet />
                    <strong>Aguardando parâmetros de cálculo</strong>
                    <p>Preencha a área e uma lâmina de evaporação obtida por medição ou método técnico validado.</p>
                  </div>
                )}
              </article>

              <aside className="agua-painel agua-metodo">
                <span className="agua-metodo__icone"><FiActivity /></span>
                <h3>Como interpretar</h3>
                <p>O resultado é uma conversão volumétrica da lâmina de evaporação informada. Ele não é, por si só, uma medição da perda real do açude.</p>
                <ul>
                  <li>A área deve corresponder à data ou ao período analisado.</li>
                  <li>A evaporação deve representar água livre, não ET₀ de referência.</li>
                  <li>O cálculo não inclui chuva, afluência, captação, liberação ou infiltração.</li>
                </ul>
                <div className="agua-aviso"><FiAlertCircle /><p>O modelo específico de evaporação será calibrado com dados meteorológicos locais e medições de campo antes de gerar indicadores oficiais.</p></div>
              </aside>
            </section>
          </>
        )}

        {aba === 'meteorologia' && (
          <>
            <TituloSecao
              titulo="Meteorologia do reservatório"
              descricao="Condições estimadas para o ponto de referência do Açude São José III."
              acao={<span className="agua-fonte"><FiCloud /> Open-Meteo · modelo meteorológico</span>}
            />

            {erroMeteo && <div className="agua-mensagem-erro"><FiAlertCircle /> {erroMeteo}</div>}

            <section className="agua-indicadores agua-indicadores--meteo">
              <Indicador titulo="Temperatura do ar" valor={formatarNumero(current?.temperature_2m, 1)} unidade="°C" nota="Estimativa do modelo" />
              <Indicador titulo="Umidade relativa" valor={formatarNumero(current?.relative_humidity_2m, 0)} unidade="%" nota="Estimativa do modelo" />
              <Indicador titulo="Velocidade do vento" valor={formatarNumero(current?.wind_speed_10m, 1)} unidade="m/s" nota="A 10 m de altura" />
              <Indicador titulo="Precipitação atual" valor={formatarNumero(current?.precipitation, 1)} unidade="mm" nota="Acumulado horário informado" tom="azul" />
            </section>

            <section className="agua-grade-visao">
              <article className="agua-painel">
                <div className="agua-painel__cabecalho">
                  <div><h3>Temperatura nas últimas 24 horas</h3><p>Série horária estimada pelo modelo meteorológico.</p></div>
                  <span className="agua-mini-status">{carregandoMeteo ? 'Atualizando…' : 'Modelo carregado'}</span>
                </div>
                <div className="agua-grafico">
                  {serieMeteorologica.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={serieMeteorologica} margin={{ top: 12, right: 18, left: 0, bottom: 4 }}>
                        <CartesianGrid stroke="#E8EFF5" strokeDasharray="3 4" vertical={false} />
                        <XAxis dataKey="horario" tick={{ fill: '#8292A3', fontSize: 10 }} axisLine={false} tickLine={false} />
                        <YAxis tick={{ fill: '#8292A3', fontSize: 11 }} axisLine={false} tickLine={false} unit="°" />
                        <Tooltip formatter={(valor: unknown) => [formatarNumero(Number(valor), 1) + ' °C', 'Temperatura']} />
                        <Line type="monotone" dataKey="temperatura" stroke="#168FC4" strokeWidth={2.5} dot={false} connectNulls={false} />
                      </LineChart>
                    </ResponsiveContainer>
                  ) : (
                    <div className="agua-vazio"><FiCloud /><strong>{carregandoMeteo ? 'Carregando meteorologia…' : 'Série horária indisponível'}</strong></div>
                  )}
                </div>
                <div className="agua-rodape-grafico">
                  <span>Horário local: America/Fortaleza</span>
                  <span>{current?.time ? 'Referência: ' + current.time.replace('T', ' ') : 'Sem horário de referência'}</span>
                </div>
              </article>

              <article className="agua-painel agua-estacao-status">
                <div className="agua-painel__cabecalho">
                  <div><h3>Estação meteorológica</h3><p>Integração preparada para a futura instalação.</p></div>
                  <span className="agua-status agua-status--pendente">Aguardando implantação</span>
                </div>
                <div className="agua-estacao-icone"><FiRadio /></div>
                <strong>Estrutura de recepção prevista</strong>
                <p>Temperatura, umidade, vento, radiação solar, precipitação, pressão atmosférica e nível da água.</p>
                <div className="agua-estacao-rodape">
                  <span>Atualização automática</span>
                  <strong>Após conexão do equipamento</strong>
                </div>
              </article>
            </section>

            {atualizacaoMeteo && (
              <p className="agua-atualizacao">Consulta realizada em {new Date(atualizacaoMeteo).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' })}. Dados estimados por modelo; não representam leitura da estação local.</p>
            )}
          </>
        )}

        {aba === 'relatorios' && (
          <>
            <TituloSecao
              titulo="Relatórios e exportações"
              descricao="Gere documentos para acompanhamento técnico e prestação de informações."
            />
            <section className="agua-relatorios-grade">
              <article className="agua-painel agua-relatorio-card">
                <span className="agua-relatorio-icone"><FiFileText /></span>
                <h3>Relatório PDF</h3>
                <p>Abre a visualização de impressão do painel. Selecione “Salvar como PDF” no navegador.</p>
                <button className="agua-botao agua-botao--primario agua-no-print" onClick={imprimirRelatorio}>
                  <FiDownload /> Gerar PDF
                </button>
              </article>
              <article className="agua-painel agua-relatorio-card">
                <span className="agua-relatorio-icone"><FiDatabase /></span>
                <h3>Série de área superficial</h3>
                <p>Exporta os registros carregados, com data, área, fonte e identificação. Para o MapBiomas, a data marca o ano de referência, não uma cena de 31/12; a área corresponde à classe anual de água mapeada.</p>
                <button
                  className="agua-botao agua-botao--secundario agua-no-print"
                  onClick={() => cenas.length ? exportarCSV(cenas) : window.alert('Importe primeiro uma série de cenas processadas.')}
                >
                  <FiDownload /> Exportar CSV
                </button>
                <small>{cenas.length} registros disponíveis</small>
              </article>
            </section>

            <section className="agua-painel">
              <div className="agua-painel__cabecalho">
                <div><h3>Conteúdo e rastreabilidade</h3><p>O relatório identifica a origem e a condição de cada conjunto de dados.</p></div>
              </div>
              <div className="agua-relatorio-lista">
                <div><FiCheckCircle /><span><strong>Cadastro técnico</strong><small>Capacidade e características da ficha COGERH.</small></span></div>
                <div><FiCloud /><span><strong>Meteorologia</strong><small>Estimativas Open-Meteo, com horário e coordenadas da consulta.</small></span></div>
                <div><FiGlobe /><span><strong>Área superficial</strong><small>Cenas importadas, sensor, data, nuvens e método de classificação.</small></span></div>
                <div><FiActivity /><span><strong>Evaporação</strong><small>Fórmula, parâmetros utilizados e distinção entre medição e estimativa.</small></span></div>
              </div>
            </section>
          </>
        )}
      </div>

      <footer className="agua-rodape">
        <span>CUIDAÍ | Água · Protótipo de monitoramento hídrico</span>
        <span>Reservatório piloto: São José III · Ipaporanga/CE</span>
      </footer>
    </main>
  );
}