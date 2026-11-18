
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    collection,
    getDocs,
    limit,
    orderBy,
    query,
    startAfter,
    Timestamp,
    where,
    type DocumentData,
    type QueryDocumentSnapshot,
    type QueryConstraint
} from 'firebase/firestore';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';
import {
    FiThermometer,
    FiDroplet,
    FiDatabase,
    FiClock,
    FiDownload,
    FiPrinter,
    FiRefreshCw
} from 'react-icons/fi';
import { db } from './firebase';
import { abrirRelatorioHistorico } from './RelatorioHistorico';
import type { EstacaoPublica } from './estacoesMunicipais';

type Leitura = {
    id: string;
    temperatura: number;
    umidade: number;
    recebidoEm: number;
};

type Periodo = 'dia' | 'semana' | 'mes';

type PontoConsolidado = {
    recebidoEm: number;
    momento: string;
    temperatura: number | null;
    umidade: number | null;
    quantidade: number;
};

type Props = {
    estacoes: EstacaoPublica[];
    idEstacaoSelecionada: string | null;
};

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;
const TAMANHO_PAGINA = 2500;
const MAXIMO_LEITURAS = 50000;
const FUSO_FORTALEZA = 'America/Fortaleza';

const OPCOES_PERIODO: {
    id: Periodo;
    titulo: string;
    duracao: number;
    agrupamento: number;
    descricao: string;
}[] = [
    {
        id: 'dia',
        titulo: '24 horas',
        duracao: DIA,
        agrupamento: 15 * 60 * 1000,
        descricao: 'Médias a cada 15 minutos'
    },
    {
        id: 'semana',
        titulo: '7 dias',
        duracao: 7 * DIA,
        agrupamento: HORA,
        descricao: 'Médias por hora'
    },
    {
        id: 'mes',
        titulo: '30 dias',
        duracao: 30 * DIA,
        agrupamento: DIA,
        descricao: 'Médias por dia'
    }
];

const formatarData = (data: number, longo = false) =>
    new Date(data).toLocaleString('pt-BR', {
        timeZone: FUSO_FORTALEZA,
        day: '2-digit',
        month: '2-digit',
        ...(longo
            ? { year: 'numeric', hour: '2-digit', minute: '2-digit' }
            : { hour: '2-digit', minute: '2-digit' })
    });

const formatarDataCompleta = (data: number) =>
    new Date(data).toLocaleString('pt-BR', {
        timeZone: FUSO_FORTALEZA,
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });

const formatarPonto = (data: number, periodo: Periodo) => {
    const opcoes: Intl.DateTimeFormatOptions = periodo === 'mes'
        ? { timeZone: FUSO_FORTALEZA, day: '2-digit', month: '2-digit' }
        : periodo === 'semana'
            ? {
                timeZone: FUSO_FORTALEZA,
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit'
            }
            : {
                timeZone: FUSO_FORTALEZA,
                hour: '2-digit',
                minute: '2-digit'
            };
    return new Date(data).toLocaleString('pt-BR', opcoes);
};

// No Ceará, o início de cada dia civil corresponde a 03:00 UTC.
const inicioDoBloco = (horario: number, intervalo: number): number => {
    const deslocamento = intervalo === DIA ? 3 * HORA : 0;
    return Math.floor(
        (horario - deslocamento) / intervalo
    ) * intervalo + deslocamento;
};

function consolidarLeituras(
    leituras: Leitura[],
    periodo: Periodo,
    inicio: number,
    fim: number
): PontoConsolidado[] {
    const opcao = OPCOES_PERIODO.find(item => item.id === periodo)!;
    const acumulados = new Map<number, {
        somaTemperatura: number;
        somaUmidade: number;
        quantidade: number;
    }>();

    leituras.forEach(leitura => {
        const bloco = inicioDoBloco(
            leitura.recebidoEm,
            opcao.agrupamento
        );
        const anterior = acumulados.get(bloco) ?? {
            somaTemperatura: 0,
            somaUmidade: 0,
            quantidade: 0
        };
        anterior.somaTemperatura += leitura.temperatura;
        anterior.somaUmidade += leitura.umidade;
        anterior.quantidade++;
        acumulados.set(bloco, anterior);
    });

    const pontos: PontoConsolidado[] = [];
    const inicioGrafico = inicioDoBloco(inicio, opcao.agrupamento);
    const fimGrafico = inicioDoBloco(fim, opcao.agrupamento);

    // Horários sem leituras continuam vazios: não interpolamos dados ausentes.
    for (
        let horario = inicioGrafico;
        horario <= fimGrafico;
        horario += opcao.agrupamento
    ) {
        const dados = acumulados.get(horario);
        pontos.push({
            recebidoEm: horario,
            momento: formatarPonto(horario, periodo),
            temperatura: dados
                ? dados.somaTemperatura / dados.quantidade
                : null,
            umidade: dados
                ? dados.somaUmidade / dados.quantidade
                : null,
            quantidade: dados?.quantidade ?? 0
        });
    }

    return pontos;
}

export default function HistoricoEstacoes({
    estacoes,
    idEstacaoSelecionada
}: Props) {
    const [idEscolhido, setIdEscolhido] =
        useState<string | null>(null);
    const [periodo, setPeriodo] = useState<Periodo>('dia');
    const [instanteConsulta, setInstanteConsulta] = useState(Date.now);
    const [leituras, setLeituras] = useState<Leitura[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [parcial, setParcial] = useState(false);

    const cache = useRef(new Map<string, {
        leituras: Leitura[];
        parcial: boolean;
        salvoEm: number;
    }>());

    const estacao =
        estacoes.find(e => e.id === idEscolhido) ??
        estacoes.find(e => e.id === idEstacaoSelecionada) ??
        estacoes[0] ??
        null;
    const idConsulta = estacao?.id ?? null;
    const opcaoPeriodo = OPCOES_PERIODO.find(
        opcao => opcao.id === periodo
    )!;
    const inicioPeriodo = instanteConsulta - opcaoPeriodo.duracao;

    useEffect(() => {
        let ativo = true;
        setLeituras([]);
        setErro(null);
        setParcial(false);

        if (!idConsulta) {
            setCarregando(false);
            return () => { ativo = false; };
        }

        const consultar = async () => {
            setCarregando(true);
            const chaveCache = `${idConsulta}:${periodo}`;
            const anterior = cache.current.get(chaveCache);
            const atual = Date.now();

            // Evita reler dezenas de milhares de documentos ao trocar de aba.
            if (
                anterior &&
                atual - anterior.salvoEm < 3 * 60 * 1000 &&
                Math.abs(atual - instanteConsulta) < 3 * 60 * 1000
            ) {
                if (ativo) {
                    setLeituras(anterior.leituras);
                    setParcial(anterior.parcial);
                    setCarregando(false);
                }
                return;
            }

            try {
                const referencia = collection(
                    db,
                    'estacoesMeteorologicas',
                    idConsulta,
                    'leituras'
                );

                const documentos = new Map<string, Leitura>();
                let limiteAtingido = false;

                // O leitor aceita tanto números em milissegundos quanto
                // Timestamp; ambos já eram reconhecidos pelo painel anterior.
                const consultarTipo = async (
                    inicio: number | Timestamp,
                    fim: number | Timestamp
                ) => {
                    let cursor: QueryDocumentSnapshot<DocumentData> | null = null;

                    while (ativo && documentos.size < MAXIMO_LEITURAS) {
                        const condicoes: QueryConstraint[] = [
                            where('recebidoEm', '>=', inicio),
                            where('recebidoEm', '<=', fim),
                            orderBy('recebidoEm', 'desc')
                        ];
                        if (cursor) {
                            condicoes.push(startAfter(cursor));
                        }
                        condicoes.push(limit(TAMANHO_PAGINA));
                        const pagina = await getDocs(query(
                            referencia,
                            ...condicoes
                        ));

                        pagina.docs.forEach(documento => {
                            const dados = documento.data();
                            const instante = typeof dados.recebidoEm?.toMillis === 'function'
                                ? dados.recebidoEm.toMillis()
                                : dados.recebidoEm;

                            if (
                                typeof dados.temperatura !== 'number' ||
                                !Number.isFinite(dados.temperatura) ||
                                dados.temperatura < -50 ||
                                dados.temperatura > 70 ||
                                typeof dados.umidade !== 'number' ||
                                !Number.isFinite(dados.umidade) ||
                                dados.umidade < 0 ||
                                dados.umidade > 100 ||
                                typeof instante !== 'number' ||
                                !Number.isFinite(instante) ||
                                instante < inicioPeriodo ||
                                instante > instanteConsulta
                            ) return;

                            if (documentos.size < MAXIMO_LEITURAS) {
                                documentos.set(documento.id, {
                                    id: documento.id,
                                    temperatura: dados.temperatura,
                                    umidade: dados.umidade,
                                    recebidoEm: instante
                                });
                            }
                        });

                        if (documentos.size >= MAXIMO_LEITURAS) {
                            limiteAtingido = true;
                            break;
                        }
                        if (pagina.size < TAMANHO_PAGINA) break;
                        cursor = pagina.docs[pagina.docs.length - 1];
                    }
                };

                await consultarTipo(inicioPeriodo, instanteConsulta);
                if (ativo && !limiteAtingido) {
                    await consultarTipo(
                        Timestamp.fromMillis(inicioPeriodo),
                        Timestamp.fromMillis(instanteConsulta)
                    );
                }

                if (!ativo) return;

                const ordenadas = Array.from(documentos.values()).sort(
                    (a, b) => a.recebidoEm - b.recebidoEm
                );

                cache.current.set(chaveCache, {
                    leituras: ordenadas,
                    parcial: limiteAtingido,
                    salvoEm: Date.now()
                });
                setLeituras(ordenadas);
                setParcial(limiteAtingido);
                setErro(null);
            } catch (falha) {
                if (!ativo) return;
                console.error('Erro ao consultar histórico:', falha);
                setErro('Não foi possível consultar o período selecionado.');
            } finally {
                if (ativo) setCarregando(false);
            }
        };

        void consultar();
        return () => { ativo = false; };
    }, [idConsulta, periodo, instanteConsulta, inicioPeriodo]);

    const pontos = useMemo(() => consolidarLeituras(
        leituras,
        periodo,
        inicioPeriodo,
        instanteConsulta
    ), [leituras, periodo, inicioPeriodo, instanteConsulta]);

    const pontosDisponiveis = useMemo(
        () => pontos.filter(ponto => ponto.quantidade > 0),
        [pontos]
    );

    const baixarCSV = (consolidado: boolean) => {
        if (!estacao || carregando || erro || leituras.length === 0) return;

        const cabecalho = consolidado
            ? [
                'Início do intervalo (Fortaleza)',
                'Temperatura média (°C)',
                'Umidade média (%)',
                'Quantidade de medições'
            ]
            : [
                'Data e hora (Fortaleza)',
                'Temperatura (°C)',
                'Umidade relativa (%)'
            ];

        const linhas = consolidado
            ? pontosDisponiveis.map(ponto => [
                formatarData(ponto.recebidoEm, true),
                ponto.temperatura!.toFixed(2).replace('.', ','),
                ponto.umidade!.toFixed(2).replace('.', ','),
                ponto.quantidade
            ].join(';'))
            : leituras.map(leitura => [
                formatarDataCompleta(leitura.recebidoEm),
                leitura.temperatura.toFixed(2).replace('.', ','),
                leitura.umidade.toFixed(2).replace('.', ',')
            ].join(';'));

        const conteudo = '\uFEFF' + [
            cabecalho.join(';'),
            ...linhas
        ].join('\r\n');

        const url = URL.createObjectURL(new Blob(
            [conteudo],
            { type: 'text/csv;charset=utf-8;' }
        ));
        const link = document.createElement('a');
        link.href = url;
        link.download = `cuidai-historico-${periodo}-${consolidado ? 'medias' : 'originais'}-${estacao.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    if (estacoes.length === 0) {
        return (
            <article className="obs-bloco">
                <h4>Histórico indisponível</h4>
                <p>Não existem estações publicadas na área selecionada.</p>
            </article>
        );
    }

    return (
        <div>
            <article className="obs-bloco">
                <h4>Estação selecionada</h4>
                <select
                    aria-label="Selecionar estação para o histórico"
                    value={estacao?.id ?? ''}
                    onChange={evento => setIdEscolhido(evento.target.value)}
                    style={{
                        width: '100%',
                        marginTop: 12,
                        padding: 12,
                        border: '1px solid #DCE8F3',
                        borderRadius: 10,
                        background: '#F5F9FD',
                        color: '#192942',
                        font: 'inherit'
                    }}
                >
                    {estacoes.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.nome}
                        </option>
                    ))}
                </select>

                <div className="historico-periodo-controles">
                    <div className="historico-periodo-topo">
                        <span>Intervalo do histórico</span>
                        <button
                            type="button"
                            onClick={() => {
                                cache.current.delete(`${idConsulta}:${periodo}`);
                                setInstanteConsulta(Date.now());
                            }}
                            disabled={carregando}
                            aria-label="Atualizar histórico"
                            title="Consultar novas medições"
                        >
                            <FiRefreshCw aria-hidden="true" />
                            Atualizar
                        </button>
                    </div>
                    <div className="historico-periodo-opcoes" role="group" aria-label="Período do histórico">
                        {OPCOES_PERIODO.map(opcao => (
                            <button
                                key={opcao.id}
                                type="button"
                                aria-pressed={periodo === opcao.id}
                                className={periodo === opcao.id
                                    ? 'historico-periodo-botao historico-periodo-botao--ativo'
                                    : 'historico-periodo-botao'}
                                onClick={() => {
                                    setPeriodo(opcao.id);
                                    setInstanteConsulta(Date.now());
                                }}
                            >
                                {opcao.titulo}
                            </button>
                        ))}
                    </div>
                    <p className="historico-periodo-descricao">
                        {opcaoPeriodo.descricao}. Horário de Fortaleza.
                    </p>
                </div>
            </article>

            {carregando && (
                <article className="obs-bloco">
                    <p role="status">Consultando medições de {opcaoPeriodo.titulo.toLowerCase()}...</p>
                </article>
            )}
            {erro && (
                <article className="obs-bloco">
                    <p role="alert">{erro}</p>
                </article>
            )}
            {!carregando && !erro && leituras.length === 0 && (
                <article className="obs-bloco">
                    <h4>Sem medições no período</h4>
                    <p>Não foram encontradas leituras válidas no intervalo escolhido.</p>
                </article>
            )}

            {!carregando && !erro && leituras.length > 0 && (
                <>
                    {parcial && (
                        <p className="historico-periodo-alerta" role="alert">
                            O limite de {MAXIMO_LEITURAS.toLocaleString('pt-BR')} leituras
                            foi alcançado. A consulta pode estar incompleta;
                            reduza o período para analisar todas as medições.
                        </p>
                    )}
                    <div className="historico-resumo">
                        <div className="historico-resumo-total">
                            <span className="historico-resumo-icone">
                                <FiDatabase />
                            </span>
                            <strong>{leituras.length.toLocaleString('pt-BR')} medições</strong>
                            <span className="historico-periodo-resumo">
                                {pontosDisponiveis.length} médias no gráfico
                            </span>
                        </div>
                        <div className="historico-resumo-periodo">
                            <FiClock aria-hidden="true" />
                            <span>
                                {formatarData(leituras[0].recebidoEm, true)}
                                {' até '}
                                {formatarData(
                                    leituras[leituras.length - 1].recebidoEm,
                                    true
                                )}
                            </span>
                        </div>
                        <details className="historico-exportacao">
                            <summary>
                                <FiDownload aria-hidden="true" />
                                Exportar
                                <span aria-hidden="true">▾</span>
                            </summary>
                            <div className="historico-exportacao-opcoes">
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (estacao) {
                                            abrirRelatorioHistorico(
                                                estacao,
                                                pontosDisponiveis.map(ponto => ({
                                                    recebidoEm: ponto.recebidoEm,
                                                    temperatura: ponto.temperatura!,
                                                    umidade: ponto.umidade!
                                                })),
                                                {
                                                    periodo: opcaoPeriodo.titulo,
                                                    agregacao: opcaoPeriodo.descricao,
                                                    totalMedicoes: leituras.length,
                                                    incompleto: parcial
                                                }
                                            );
                                        }
                                    }}
                                >
                                    <FiPrinter aria-hidden="true" />
                                    Relatório para impressão / PDF
                                </button>
                                <button type="button" onClick={() => baixarCSV(true)}>
                                    <FiDownload aria-hidden="true" />
                                    Médias do gráfico (CSV)
                                </button>
                                <button type="button" onClick={() => baixarCSV(false)}>
                                    <FiDownload aria-hidden="true" />
                                    Medições originais (CSV)
                                </button>
                            </div>
                        </details>
                    </div>

                    {pontosDisponiveis.length >= 2 ? (
                        ([
                            {
                                campo: 'temperatura',
                                titulo: 'Evolução da temperatura média',
                                unidade: '°C',
                                cor: '#DC7A40'
                            },
                            {
                                campo: 'umidade',
                                titulo: 'Evolução da umidade média',
                                unidade: '%',
                                cor: '#348CCB'
                            }
                        ] as const).map(grafico => (
                            <article
                                className={`obs-bloco historico-grafico historico-grafico--${grafico.campo}`}
                                key={grafico.campo}
                            >
                                <div className="historico-grafico-cabecalho">
                                    <span
                                        className="historico-grafico-icone"
                                        aria-hidden="true"
                                    >
                                        {grafico.campo === 'temperatura'
                                            ? <FiThermometer />
                                            : <FiDroplet />}
                                    </span>
                                    <h4>{grafico.titulo}</h4>
                                </div>

                                <div style={{
                                    width: '100%',
                                    height: 240,
                                    marginTop: 18
                                }}>
                                    <ResponsiveContainer
                                        width="100%"
                                        height="100%"
                                        initialDimension={{ width: 300, height: 240 }}
                                    >
                                        <LineChart
                                            data={pontos}
                                            margin={{ top: 8, right: 12, left: -20, bottom: 8 }}
                                        >
                                            <CartesianGrid
                                                stroke="#E6EDF5"
                                                strokeDasharray="3 3"
                                                vertical={false}
                                            />
                                            <XAxis
                                                dataKey="momento"
                                                minTickGap={34}
                                                tick={{ fontSize: 10 }}
                                            />
                                            <YAxis
                                                domain={['auto', 'auto']}
                                                tick={{ fontSize: 11 }}
                                            />
                                            <Tooltip
                                                formatter={valor =>
                                                    `${Number(valor).toFixed(1).replace('.', ',')} ${grafico.unidade}`
                                                }
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey={grafico.campo}
                                                name={grafico.titulo}
                                                stroke={grafico.cor}
                                                strokeWidth={2.5}
                                                dot={pontosDisponiveis.length <= 12}
                                                connectNulls={false}
                                                isAnimationActive={true}
                                                animationDuration={650}
                                                activeDot={{ r: 5 }}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </article>
                        ))
                    ) : (
                        <article className="obs-bloco">
                            <p>Há dados em apenas um intervalo. São necessários
                            pelo menos dois intervalos com medições para desenhar a evolução.</p>
                        </article>
                    )}
                    <p className="historico-fonte">
                        Fonte: Estação CUIDAÍ • Dados medidos pelos sensores,
                        não estimativas da Open-Meteo.
                        Os gráficos apresentam médias das medições disponíveis
                        em cada intervalo; horários sem dados permanecem vazios.
                        As exportações permitem consultar tanto as médias quanto
                        as medições originais do período selecionado.
                    </p>
                </>
            )}
        </div>
    );
}
