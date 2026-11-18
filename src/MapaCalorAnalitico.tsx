import { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, useMap } from 'react-leaflet';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import L from 'leaflet';
import 'leaflet.heat';
import { FiArrowLeft, FiCloudRain, FiDroplet, FiMap, FiSun, FiThermometer, FiWind, FiZap, FiAlertCircle } from 'react-icons/fi';
import {
  alertaAtivo,
  CORES_OCORRENCIAS,
  sombraDoAlerta,
  statusDoAlerta,
  subcategoriasDoAlerta,
  type AlertaTerritorial,
  type Sombra
} from './territorioOcorrencias';
import EnergiaAnalise from './EnergiaAnalise';
import './mapaCalorAnalitico.css';

type Modo = 'atuais' | 'historico';
type Janela = '24h' | '7d' | '30d' | 'datas';
type Props = {
  alertas: AlertaTerritorial[];
  centro: [number, number] | null;
  agora: number;
};

const DIA = 24 * 60 * 60 * 1000;
const SOMBRAS: Sombra[] = ['Sim', 'Não', 'Parcialmente', 'Não informado'];

const CATEGORIAS_ALERTA = [
  { chave: 'Chuvas', rotulo: 'Chuva', Icone: FiCloudRain },
  { chave: 'Quentura', rotulo: 'Quentura', Icone: FiSun },
  { chave: 'Estrada', rotulo: 'Estrada', Icone: FiMap },
  { chave: 'Passagem', rotulo: 'Passagem molhada', Icone: FiDroplet },
  { chave: 'Energia', rotulo: 'Energia', Icone: FiZap }
] as const;

function iconeSubcategoria(categoria: string, nome: string) {
  const texto = nome.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (categoria === 'Quentura') {
    if (texto.includes('sol')) return FiSun;
    if (texto.includes('mormaco')) return FiThermometer;
    if (texto.includes('ar parado')) return FiWind;
  }
  return CATEGORIAS_ALERTA.find(item => item.chave === categoria)?.Icone ?? FiAlertCircle;
}
const gradienteTodas = { 0.10: '#B8E2FF', 0.325: '#329EED', 0.55: '#46D898', 0.775: '#F9E14D', 1.00: '#FF6155' };
const gradientes: Record<string, Record<number, string>> = {
  Todas: gradienteTodas,
  Chuvas: { 0.1: '#C6EAFF', 0.325: '#85D4FA', 0.55: '#43B9F0', 0.775: '#168FDC', 1: '#176FC4' },
  Passagem: { 0.1: '#FFF3AA', 0.325: '#FFE27A', 0.55: '#FFC54C', 0.775: '#F7A832', 1: '#E98C29' },
  Energia: { 0.1: '#EBDFFF', 0.325: '#D0B7FF', 0.55: '#B58BF4', 0.775: '#966FE4', 1: '#805CCD' },
  Estrada: { 0.1: '#D5F3C5', 0.325: '#A9E8B0', 0.55: '#76D89C', 0.775: '#42BE83', 1: '#249F72' },
  Quentura: { 0.1: '#FFE1CF', 0.325: '#FFB99A', 0.55: '#FF936D', 0.775: '#F66C50', 1: '#E84B43' }
};

function CamadaOcorrencias({ alertas, categoria }: {
  alertas: AlertaTerritorial[];
  categoria: string;
}) {
  const mapa = useMap();
  useEffect(() => {
    if (alertas.length === 0) return;
    const gradiente = gradientes[categoria] ?? gradienteTodas;
    const camada = L.heatLayer(
      alertas.map(a => [a.latitude, a.longitude, 0.4] as [number, number, number]),
      { radius: 30, blur: 6, maxZoom: 15, max: 1, minOpacity: 0.35, gradient: gradiente }
    ).addTo(mapa);
    return () => { mapa.removeLayer(camada); };
  }, [mapa, alertas, categoria]);
  return null;
}

const diaLocal = (instante: number) =>
  new Date(instante - 3 * 60 * 60 * 1000).toISOString().slice(0, 10);

const intervaloLocal = (inicio: string, fim: string) => {
  const a = Date.parse(`${inicio}T00:00:00.000-03:00`);
  const b = Date.parse(`${fim}T23:59:59.999-03:00`);
  return { inicio: a, fim: b, valido: Number.isFinite(a) && Number.isFinite(b) && a <= b };
};

function agruparContagem(valores: string[]): { nome: string; quantidade: number }[] {
  const contagens = new Map<string, number>();
  valores.forEach(valor => contagens.set(valor, (contagens.get(valor) ?? 0) + 1));
  return [...contagens].map(([nome, quantidade]) => ({ nome, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.nome.localeCompare(b.nome, 'pt-BR'));
}

function exportarCSV(alertas: AlertaTerritorial[], agora: number) {
  const campo = (valor: unknown): string =>
    `"${String(valor ?? '').replace(/"/g, '""')}"`;
  const cabecalho = [
    'ID', 'Data de criação', 'Categoria', 'Subcategoria(s)', 'Detalhe original',
    'Sombra', 'Status atual', 'Validade (ms)', 'Confirmacoes', 'Resolucoes',
    'Latitude', 'Longitude'
  ];
  const linhas = alertas.map(a => [
    a.id,
    a.criadoEm ? new Date(a.criadoEm).toLocaleString('pt-BR', { timeZone: 'America/Fortaleza' }) : '',
    a.categoria,
    subcategoriasDoAlerta(a).join(' + '),
    a.detalhe ?? '',
    a.categoria === 'Quentura' ? sombraDoAlerta(a) : '',
    statusDoAlerta(a, agora),
    a.expiraEm ?? '',
    a.votosConfirma ?? 0,
    a.votosResolvido ?? 0,
    a.latitude,
    a.longitude
  ].map(campo).join(';'));
  const blob = new Blob(['\uFEFF', cabecalho.map(campo).join(';'), '\r\n', linhas.join('\r\n')],
    { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `cuidai-ocorrencias-territoriais-${diaLocal(agora)}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export default function MapaCalorAnalitico({ alertas, centro, agora }: Props) {
  const [modo, setModo] = useState<Modo>('atuais');
  const [janela, setJanela] = useState<Janela>('7d');
  const [dataInicio, setDataInicio] = useState(() => diaLocal(Date.now() - 7 * DIA));
  const [dataFim, setDataFim] = useState(() => diaLocal(Date.now()));
  const [categoria, setCategoria] = useState('Todas');
  const [subcategoria, setSubcategoria] = useState('Todas');
  const [sombra, setSombra] = useState<Sombra | 'Todas'>('Todas');
  const [ajuda, setAjuda] = useState(false);

  const intervalo = useMemo(() => {
    if (janela === 'datas') return intervaloLocal(dataInicio, dataFim);
    const duracao = janela === '24h' ? DIA : janela === '7d' ? 7 * DIA : 30 * DIA;
    return { inicio: agora - duracao, fim: agora, valido: true };
  }, [janela, agora, dataInicio, dataFim]);

  // "Ao vivo" = ativos agora. "Histórico" = criados no período, independentemente
  // de terem sido posteriormente encerrados ou vencidos.
  const base = useMemo(() => alertas.filter(a => modo === 'atuais'
    ? alertaAtivo(a, agora)
    : intervalo.valido &&
      typeof a.criadoEm === 'number' &&
      a.criadoEm >= intervalo.inicio &&
      a.criadoEm <= intervalo.fim
  ), [alertas, modo, agora, intervalo]);

  const categoriasPeriodo = useMemo(() => agruparContagem(
    base.map(a => a.categoria)
  ), [base]);

  const porCategoria = useMemo(() => base.filter(a =>
    categoria === 'Todas' || a.categoria === categoria
  ), [base, categoria]);

  const subcategorias = useMemo(() => categoria === 'Todas' ? [] :
    agruparContagem(porCategoria.flatMap(subcategoriasDoAlerta))
  , [categoria, porCategoria]);

  const porSubcategoria = useMemo(() => porCategoria.filter(a =>
    subcategoria === 'Todas' ||
    subcategoriasDoAlerta(a).includes(subcategoria)
  ), [porCategoria, subcategoria]);

  const sombras = useMemo(() => agruparContagem(
    porSubcategoria.filter(a => a.categoria === 'Quentura').map(sombraDoAlerta)
  ), [porSubcategoria]);
  const totalRegistrosQuentura = porSubcategoria.filter(
    a => a.categoria === 'Quentura'
  ).length;

  const filtrados = useMemo(() => porSubcategoria.filter(a =>
    categoria !== 'Quentura' || sombra === 'Todas' || sombraDoAlerta(a) === sombra
  ), [porSubcategoria, categoria, sombra]);

  const coresLegenda = Object.entries(gradientes[categoria] ?? gradienteTodas)
    .sort(([a], [b]) => Number(a) - Number(b))
    .map(([, cor]) => cor);
  const fundoLegenda = `linear-gradient(to right, ${coresLegenda.join(', ')})`;

  const totalVencidos = base.filter(a => statusDoAlerta(a, agora) === 'expirado').length;
  const totalResolvidos = base.filter(a => statusDoAlerta(a, agora) === 'resolvido').length;
  const maxSubcategoria = Math.max(1, ...subcategorias.map(a => a.quantidade));

  // Comparação histórica entre períodos equivalentes do mês atual e anterior.
  // Usa a data de criação, não o status vigente, para não inventar um histórico de ativos.
  const comparativoMensal = useMemo(() => {
    const horaLocal = new Date(agora - 3 * 60 * 60 * 1000);
    const ano = horaLocal.getUTCFullYear();
    const mes = horaLocal.getUTCMonth();
    const dia = horaLocal.getUTCDate();
    const diasMesAnterior = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
    const diasComparados = Math.min(dia, diasMesAnterior);
    const inicioAtual = Date.UTC(ano, mes, 1, 3);
    const fimAtual = Math.min(agora, Date.UTC(ano, mes, diasComparados + 1, 3) - 1);
    const inicioAnterior = Date.UTC(ano, mes - 1, 1, 3);
    const fimAnterior = Date.UTC(ano, mes - 1, diasComparados + 1, 3) - 1;
    const registros = alertas.filter(alerta =>
      typeof alerta.criadoEm === 'number' &&
      (categoria === 'Todas' || alerta.categoria === categoria) &&
      (subcategoria === 'Todas' || subcategoriasDoAlerta(alerta).includes(subcategoria)) &&
      (categoria !== 'Quentura' || sombra === 'Todas' || sombraDoAlerta(alerta) === sombra)
    );
    const contar = (inicio: number, fim: number) =>
      registros.filter(alerta => (alerta.criadoEm ?? -1) >= inicio &&
        (alerta.criadoEm ?? -1) <= fim).length;
    const atual = contar(inicioAtual, fimAtual);
    const anterior = contar(inicioAnterior, fimAnterior);
    const nomeAtual = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(ano, mes, 1)));
    const nomeAnterior = new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' })
      .format(new Date(Date.UTC(ano, mes - 1, 1)));
    const periodo = `1º a ${diasComparados} de ${nomeAtual}`;
    if (atual === 0 && anterior === 0)
      return `Nenhum registro criado de ${periodo} ou no mesmo período de ${nomeAnterior}.`;
    if (anterior === 0)
      return `${atual} registro(s) criado(s) de ${periodo}; nenhum no mesmo período de ${nomeAnterior}.`;
    const variacao = Math.round((atual - anterior) / anterior * 100);
    if (variacao === 0)
      return `De ${periodo}: ${atual} registro(s), mesma quantidade do período equivalente de ${nomeAnterior}.`;
    return `De ${periodo}: ${atual} registro(s), ${Math.abs(variacao)}% ${variacao > 0 ? 'a mais' : 'a menos'} que no mesmo período de ${nomeAnterior} (${anterior}).`;
  }, [alertas, agora, categoria, subcategoria, sombra]);

  // Número por dia ou mês de criação. Não afirma que esses registros
  // estavam ativos na época, porque faltam carimbos de resolução.
  const dadosEvolucao = useMemo(() => {
    const periodoDias = modo === 'historico' && intervalo.valido
      ? (intervalo.fim - intervalo.inicio) / DIA : 0;
    const porMes = periodoDias > 60;
    const contagem = new Map<string, number>();
    for (const alerta of filtrados) {
      if (!alerta.criadoEm) continue;
      const chave = porMes ? diaLocal(alerta.criadoEm).slice(0, 7) : diaLocal(alerta.criadoEm);
      contagem.set(chave, (contagem.get(chave) ?? 0) + 1);
    }

    // Inclui períodos sem registros no eixo: ausência de ocorrências
    // também faz parte da análise temporal.
    if (modo === 'historico' && intervalo.valido) {
      const inicioUTC = Date.parse(diaLocal(intervalo.inicio) + 'T00:00:00Z');
      const fimUTC = Date.parse(diaLocal(intervalo.fim) + 'T00:00:00Z');
      if (porMes) {
        const cursor = new Date(inicioUTC);
        cursor.setUTCDate(1);
        while (cursor.getTime() <= fimUTC) {
          const chave = cursor.toISOString().slice(0, 7);
          if (!contagem.has(chave)) contagem.set(chave, 0);
          cursor.setUTCMonth(cursor.getUTCMonth() + 1);
        }
      } else {
        for (let instante = inicioUTC; instante <= fimUTC; instante += DIA) {
          const chave = new Date(instante).toISOString().slice(0, 10);
          if (!contagem.has(chave)) contagem.set(chave, 0);
        }
      }
    }

    return [...contagem].sort(([a], [b]) => a.localeCompare(b))
      .map(([data, quantidade]) => ({
        data: porMes ? data.slice(5, 7) + '/' + data.slice(0, 4)
          : data.slice(8, 10) + '/' + data.slice(5, 7),
        quantidade
      }));
  }, [filtrados, modo, intervalo]);

  const semData = alertas.filter(a => !a.criadoEm).length;

  return (
    <section className="territorio-analise">
      <div className="territorio-analise__topo">
        <div className="territorio-analise__topo-esquerda">
          <header className="territorio-analise__cabecalho">
            <h1>Mapa de Calor</h1>
            <p>Distribuição dos alertas no território.</p>
          </header>

          <div className="territorio-analise__modos" role="group" aria-label="Tipo de consulta">
            <button type="button" className={modo === 'atuais' ? 'ativo' : ''}
              aria-pressed={modo === 'atuais'} onClick={() => setModo('atuais')}>
              Ativos agora
            </button>
            <button type="button" className={modo === 'historico' ? 'ativo' : ''}
              aria-pressed={modo === 'historico'} onClick={() => setModo('historico')}>
              Histórico
            </button>
          </div>

          {modo === 'historico' && (
            <div className="territorio-analise__periodo">
              <div className="territorio-analise__opcoes" role="group" aria-label="Período histórico">
                {([
                  ['24h', '24 horas'], ['7d', '7 dias'],
                  ['30d', '30 dias'], ['datas', 'Datas']
                ] as const).map(([valor, nome]) => (
                  <button type="button" key={valor} className={janela === valor ? 'ativo' : ''}
                    aria-pressed={janela === valor} onClick={() => setJanela(valor)}>
                    {nome}
                  </button>
                ))}
              </div>
              {janela === 'datas' && (
                <div className="territorio-analise__datas">
                  <label>De <input type="date" value={dataInicio} max={dataFim}
                    onChange={e => setDataInicio(e.target.value)} /></label>
                  <label>Até <input type="date" value={dataFim} min={dataInicio}
                    max={diaLocal(agora)} onChange={e => setDataFim(e.target.value)} /></label>
                </div>
              )}
              {!intervalo.valido && <p role="alert">Selecione uma data inicial anterior à final.</p>}
            </div>
          )}

          <p className="territorio-analise__comparativo" aria-live="polite">
            {comparativoMensal}
          </p>
        </div>

        <div className="territorio-analise__topo-direita">
          <section className="territorio-analise__painel-exploracao" aria-label="Categorias e subcategorias">
            {categoria === 'Todas' ? (
              <div className="territorio-analise__categorias-cards" role="group"
                aria-label="Selecionar categoria do mapa">
                {CATEGORIAS_ALERTA.map(({ chave, rotulo, Icone }) => {
                  const quantidade = categoriasPeriodo.find(d => d.nome === chave)?.quantidade ?? 0;
                  return (
                    <button key={chave} type="button"
                      className="territorio-analise__categoria-card"
                      title={`Filtrar ${rotulo} · ${quantidade} registro(s) neste recorte`}
                      aria-label={`${rotulo}: ${quantidade} registro(s). Filtrar mapa`}
                      onClick={() => {
                        setCategoria(chave);
                        setSubcategoria('Todas');
                        setSombra('Todas');
                      }}>
                      <Icone size={27} color={CORES_OCORRENCIAS[chave]} aria-hidden="true" />
                      <span>{rotulo}</span>
                    </button>
                  );
                })}
              </div>
            ) : (
              <>
                <div className="territorio-analise__exploracao-cabecalho">
                  <button type="button" className="territorio-analise__voltar-categorias"
                    onClick={() => {
                      setCategoria('Todas');
                      setSubcategoria('Todas');
                      setSombra('Todas');
                    }}>
                    <FiArrowLeft size={15} aria-hidden="true" /> Todas as categorias
                  </button>
                  <h2>{CATEGORIAS_ALERTA.find(item => item.chave === categoria)?.rotulo ?? categoria}
                    <span> · Condições registradas</span>
                  </h2>
                  {(subcategoria !== 'Todas' || sombra !== 'Todas') && (
                    <button type="button" className="territorio-analise__limpar-selecao"
                      onClick={() => {
                        setSubcategoria('Todas');
                        setSombra('Todas');
                      }}>
                      Limpar seleção
                    </button>
                  )}
                </div>
                {subcategorias.length === 0 ? (
                  <p className="territorio-analise__sem-subcategorias">
                    Nenhuma subcategoria registrada neste recorte.
                  </p>
                ) : (
                  <div className="territorio-analise__subcategorias-grid" role="group"
                    aria-label={`Subcategorias de ${categoria}`}>
                    {subcategorias.map(d => {
                      const Icone = iconeSubcategoria(categoria, d.nome);
                      const cor = CORES_OCORRENCIAS[categoria] ?? '#6E91B1';
                      return (
                        <button className="territorio-analise__subcategoria-card"
                          key={d.nome} type="button"
                          aria-pressed={subcategoria === d.nome}
                          title={subcategoria === d.nome ? 'Mostrar todas as subcategorias' : `Filtrar ${d.nome}`}
                          onClick={() => {
                            setSubcategoria(atual => atual === d.nome ? 'Todas' : d.nome);
                            setSombra('Todas');
                          }}>
                          <div className="territorio-analise__subcategoria-descricao">
                            <Icone size={17} color={cor} aria-hidden="true" />
                            <span>{d.nome}</span>
                            <strong>{d.quantidade}</strong>
                          </div>
                          <div className="territorio-analise__barra-trilho" aria-hidden="true">
                            <i style={{
                              width: `${100 * d.quantidade / maxSubcategoria}%`,
                              backgroundColor: cor
                            }} />
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
                {categoria === 'Quentura' && (
                  <p className="territorio-analise__nota-condicoes">
                    Um relato pode indicar várias condições; as contagens não devem ser somadas.
                  </p>
                )}
              </>
            )}
          </section>
        </div>
      </div>

      <div className="territorio-analise__metricas territorio-analise__metricas--resumo">
        <div><strong>{filtrados.length.toLocaleString('pt-BR')}</strong>
          <span>{modo === 'atuais' ? 'Ativos agora' : 'No período'}</span></div>
        <div><strong>{new Set(filtrados.map(a => a.categoria)).size}</strong>
          <span>Categorias</span></div>
        <div><strong>{new Set(filtrados.flatMap(subcategoriasDoAlerta)).size}</strong>
          <span>Tipos/condições</span></div>
        {modo === 'historico' && (
          <div><strong>{totalResolvidos + totalVencidos}</strong>
            <span>Já encerrados</span></div>
        )}
        {(subcategoria !== 'Todas' || sombra !== 'Todas') && (
          <span className="territorio-analise__recorte-atual">
            Exibindo: {subcategoria !== 'Todas' ? subcategoria : categoria}
            {sombra !== 'Todas' ? ` · Sombra: ${sombra}` : ''}
          </span>
        )}
        <button type="button" onClick={() => exportarCSV(filtrados, agora)}
          disabled={filtrados.length === 0} title="Exportar registros filtrados sem dados pessoais">
          Exportar CSV
        </button>
      </div>

      <div className="territorio-analise__mapa" role="region"
        aria-label="Mapa de calor das ocorrências selecionadas">
        <MapContainer center={centro ?? ([-5.3, -39.3] as [number, number])} zoom={14}
          style={{ width: '100%', height: '100%', background: '#FFFFFF' }}>
          <TileLayer className="mapa-cuidai"
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
          <CamadaOcorrencias alertas={filtrados} categoria={categoria} />
        </MapContainer>
        <div className="territorio-analise__legenda">
          <strong>Concentração de registros</strong>
          <span>Menor <i style={{ background: fundoLegenda }} /> Maior</span>
          <small>{modo === 'atuais'
            ? 'Somente alertas com validade vigente'
            : 'Ocorrências criadas no período selecionado'}</small>
        </div>
        {filtrados.length === 0 && (
          <div className="territorio-analise__sem-dados">
            Nenhuma ocorrência encontrada para os filtros selecionados.
          </div>
        )}
      </div>

      {categoria === 'Energia' && (
        <EnergiaAnalise
          alertas={alertas}
          modo={modo}
          inicioPeriodo={intervalo.inicio}
          fimPeriodo={intervalo.fim}
          periodoValido={intervalo.valido}
          subcategoria={subcategoria}
          agora={agora}
        />
      )}

      {(categoria === 'Quentura' || modo === 'historico') && (
        <div className="territorio-analise__analiticos">
            {categoria === 'Quentura' && (
            <section>
              <h2>Distribuição da sombra</h2>
              <div className="territorio-analise__sombra">
                {SOMBRAS.map(resposta => {
                  const quantidade = sombras.find(x => x.nome === resposta)?.quantidade ?? 0;
                  return <button key={resposta} type="button"
                    aria-pressed={sombra === resposta}
                    className={sombra === resposta ? 'ativo' : ''}
                    onClick={() => setSombra(atual => atual === resposta ? 'Todas' : resposta)}>
                    <strong>{quantidade}</strong>
                    <span>{resposta} • {totalRegistrosQuentura
                      ? Math.round(quantidade / totalRegistrosQuentura * 100)
                      : 0}%</span>
                  </button>;
                })}
              </div>
              <p>Respostas declaradas pela comunidade. “Não informado” não significa ausência de sombra.</p>
            </section>
          )}

          {modo === 'historico' && (
            <section className="territorio-analise__evolucao">
              <h2>Evolução dos registros criados</h2>
              {dadosEvolucao.length ? (
                <ResponsiveContainer width="100%" height={188}>
                  <BarChart data={dadosEvolucao} margin={{ top: 10, right: 8, left: -22, bottom: 3 }}>
                    <CartesianGrid vertical={false} stroke="#E9EFF5" />
                    <XAxis dataKey="data" minTickGap={18} tick={{ fontSize: 10 }} />
                    <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                    <Tooltip />
                    <Bar dataKey="quantidade" name="Ocorrências criadas"
                      fill="#4D8BB0" radius={[3, 3, 0, 0]} maxBarSize={28} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p>Sem registros com data válida neste intervalo.</p>}
            </section>
          )}
        </div>
      )}

      <footer className="territorio-analise__nota">
        <button type="button" onClick={() => setAjuda(aberta => !aberta)}
          aria-expanded={ajuda}>Como interpretar {ajuda ? '−' : '+'}</button>
        {ajuda && <p>
          O mapa representa concentração de relatos, não temperatura, gravidade nem risco calculado.
          No modo Histórico, cada registro é localizado pela data em que foi criado, mesmo que
          tenha sido resolvido ou expirado depois. Isso não reconstrói exatamente quais alertas
          estavam ativos naquela data. Os dados dependem dos documentos ainda preservados no
          Firestore; registros excluídos não podem ser recuperados por este painel.
        </p>}
        {semData > 0 && modo === 'historico' && (
          <small>{semData} registro(s) sem data de criação não entram nas consultas históricas.</small>
        )}
      </footer>
    </section>
  );
}
