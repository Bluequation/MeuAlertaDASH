
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
    FiRefreshCw,
    FiChevronLeft,
    FiChevronRight,
    FiGitMerge
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

type Periodo = 'hora' | 'dia' | 'semana' | 'mes';

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
        id: 'hora',
        titulo: '1 hora',
        duracao: HORA,
        agrupamento: 60 * 1000,
        descricao: 'Leituras por minuto'
    },
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
        titulo: 'Mês',
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


type ResultadoConsulta = { leituras: Leitura[]; parcial: boolean };
type PontoGrafico = PontoConsolidado & {
    temperaturaComparacao: number | null;
    umidadeComparacao: number | null;
    momentoComparacao?: string;
};

const paraInputData = (instante: number, periodo: Periodo): string => {
    // Ceará: UTC-03, sem horário de verão.
    const data = new Date(instante - 3 * HORA).toISOString();
    return periodo === 'hora' ? data.slice(0, 16)
        : periodo === 'mes' ? data.slice(0, 7)
            : data.slice(0, 10);
};

const inicioMes = (instante: number): number => {
    const anoMes = paraInputData(instante, 'mes');
    return Date.parse(`${anoMes}-01T00:00:00-03:00`);
};

const lerDataSelecionada = (valor: string, periodo: Periodo): number | null => {
    let instante: number;
    if (periodo === 'mes') {
        if (!/^\d{4}-\d{2}$/.test(valor)) return null;
        const [ano, mes] = valor.split('-').map(Number);
        if (mes < 1 || mes > 12) return null;
        const diaFinal = new Date(Date.UTC(ano, mes, 0)).getUTCDate();
        instante = Date.parse(`${valor}-${String(diaFinal).padStart(2, '0')}T23:59:59.999-03:00`);
    } else {
        const complemento = periodo === 'hora'
            ? ':00-03:00'
            : 'T23:59:59.999-03:00';
        instante = Date.parse(valor + complemento);
    }
    return Number.isFinite(instante)
        ? Math.min(instante, Date.now())
        : null;
};

const mudarMes = (instante: number, direcao: -1 | 1): number => {
    const [ano, mes] = paraInputData(instante, 'mes').split('-').map(Number);
    const primeiroDia = new Date(Date.UTC(ano, mes - 1 + direcao, 1))
        .toISOString().slice(0, 7);
    return lerDataSelecionada(primeiroDia, 'mes') ?? instante;
};

const descricaoIntervalo = (inicio: number, fim: number) =>
    `${formatarData(inicio, true)} – ${formatarData(fim, true)}`;

async function consultarMedicoes(
    id: string,
    inicio: number,
    fim: number,
    continuar: () => boolean
): Promise<ResultadoConsulta> {
    const referencia = collection(db, 'estacoesMeteorologicas', id, 'leituras');
    const encontrados = new Map<string, Leitura>();
    let parcial = false;

    const buscarTipo = async (limiteInicio: number | Timestamp, limiteFim: number | Timestamp) => {
        let cursor: QueryDocumentSnapshot<DocumentData> | null = null;
        while (continuar() && encontrados.size < MAXIMO_LEITURAS) {
            const condicoes: QueryConstraint[] = [
                where('recebidoEm', '>=', limiteInicio),
                where('recebidoEm', '<=', limiteFim),
                orderBy('recebidoEm', 'desc')
            ];
            if (cursor) condicoes.push(startAfter(cursor));
            condicoes.push(limit(TAMANHO_PAGINA));

            const pagina = await getDocs(query(referencia, ...condicoes));
            if (!continuar()) return;

            for (const documento of pagina.docs) {
                const dados = documento.data();
                const instante = typeof dados.recebidoEm?.toMillis === 'function'
                    ? dados.recebidoEm.toMillis() : dados.recebidoEm;
                if (
                    typeof dados.temperatura !== 'number' ||
                    !Number.isFinite(dados.temperatura) ||
                    dados.temperatura < -50 || dados.temperatura > 70 ||
                    typeof dados.umidade !== 'number' ||
                    !Number.isFinite(dados.umidade) ||
                    dados.umidade < 0 || dados.umidade > 100 ||
                    typeof instante !== 'number' ||
                    !Number.isFinite(instante) ||
                    instante < inicio || instante > fim
                ) continue;

                if (encontrados.size < MAXIMO_LEITURAS) {
                    encontrados.set(documento.id, {
                        id: documento.id,
                        temperatura: dados.temperatura,
                        umidade: dados.umidade,
                        recebidoEm: instante
                    });
                }
            }
            if (encontrados.size >= MAXIMO_LEITURAS) {
                parcial = true;
                break;
            }
            if (pagina.size < TAMANHO_PAGINA) break;
            cursor = pagina.docs[pagina.docs.length - 1];
        }
    };

    await buscarTipo(inicio, fim);
    if (continuar() && !parcial) {
        await buscarTipo(Timestamp.fromMillis(inicio), Timestamp.fromMillis(fim));
    }
    return {
        leituras: [...encontrados.values()].sort((a, b) => a.recebidoEm - b.recebidoEm),
        parcial
    };
}

export default function HistoricoEstacoes({
    estacoes,
    idEstacaoSelecionada
}: Props) {
    const [idEscolhido, setIdEscolhido] =
        useState<string | null>(null);
    const [periodo, setPeriodo] = useState<Periodo>('hora');
    const [instanteConsulta, setInstanteConsulta] = useState(Date.now);
    const [seguindoAgora, setSeguindoAgora] = useState(true);
    const [comparar, setComparar] = useState(false);
    const [instanteComparacao, setInstanteComparacao] =
        useState<number | null>(null);
    const [revisao, setRevisao] = useState(0);

    const [leituras, setLeituras] = useState<Leitura[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);
    const [parcial, setParcial] = useState(false);
    const [leiturasComparacao, setLeiturasComparacao] = useState<Leitura[]>([]);
    const [carregandoComparacao, setCarregandoComparacao] = useState(false);
    const [erroComparacao, setErroComparacao] = useState<string | null>(null);
    const [parcialComparacao, setParcialComparacao] = useState(false);

    const cache = useRef(new Map<string, ResultadoConsulta & {
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
    const inicioPeriodo = periodo === 'mes'
        ? inicioMes(instanteConsulta)
        : instanteConsulta - opcaoPeriodo.duracao;


    const fimComparacao = instanteComparacao ??
        (periodo === 'mes'
            ? mudarMes(instanteConsulta, -1)
            : instanteConsulta - opcaoPeriodo.duracao);
    const inicioComparacao = periodo === 'mes'
        ? inicioMes(fimComparacao)
        : fimComparacao - opcaoPeriodo.duracao;

    const periodoAnterior = () => periodo === 'mes'
        ? mudarMes(instanteConsulta, -1)
        : instanteConsulta - opcaoPeriodo.duracao;

    const navegarPeriodo = (direcao: -1 | 1) => {
        const proximo = periodo === 'mes'
            ? mudarMes(instanteConsulta, direcao)
            : Math.min(
                Date.now(), instanteConsulta + direcao * opcaoPeriodo.duracao
            );
        setSeguindoAgora(proximo >= Date.now() - 60 * 1000);
        setInstanteConsulta(proximo);
    };

    useEffect(() => {
        let ativo = true;
        const continuar = () => ativo;
        const cacheLocal = cache.current;

        const consultar = async (
            inicio: number,
            fim: number,
            ajustarCarregamento: (valor: boolean) => void,
            ajustarLeituras: (valor: Leitura[]) => void,
            ajustarParcial: (valor: boolean) => void,
            ajustarErro: (valor: string | null) => void
        ) => {
            if (!idConsulta) {
                ajustarCarregamento(false);
                ajustarLeituras([]);
                ajustarParcial(false);
                ajustarErro(null);
                return;
            }

            ajustarCarregamento(true);
            ajustarErro(null);
            ajustarLeituras([]);
            ajustarParcial(false);

            const chave = `${idConsulta}:${inicio}:${fim}`;
            const anterior = cacheLocal.get(chave);
            if (anterior && Date.now() - anterior.salvoEm < 3 * 60 * 1000) {
                if (ativo) {
                    ajustarLeituras(anterior.leituras);
                    ajustarParcial(anterior.parcial);
                    ajustarCarregamento(false);
                }
                return;
            }

            try {
                const resultado = await consultarMedicoes(
                    idConsulta, inicio, fim, continuar
                );
                if (!ativo) return;
                cacheLocal.set(chave, { ...resultado, salvoEm: Date.now() });
                ajustarLeituras(resultado.leituras);
                ajustarParcial(resultado.parcial);
            } catch (falha) {
                if (!ativo) return;
                console.error('Erro ao consultar série histórica:', falha);
                ajustarErro('Não foi possível consultar o período selecionado.');
            } finally {
                if (ativo) ajustarCarregamento(false);
            }
        };

        void consultar(
            inicioPeriodo, instanteConsulta,
            setCarregando, setLeituras, setParcial, setErro
        );

        if (comparar) {
            void consultar(
                inicioComparacao, fimComparacao,
                setCarregandoComparacao,
                setLeiturasComparacao,
                setParcialComparacao,
                setErroComparacao
            );
        } else {
            setCarregandoComparacao(false);
            setLeiturasComparacao([]);
            setErroComparacao(null);
            setParcialComparacao(false);
        }

        return () => { ativo = false; };
    }, [
        idConsulta, inicioPeriodo, instanteConsulta,
        comparar, inicioComparacao, fimComparacao, revisao
    ]);

    const pontos = useMemo(
        () => consolidarLeituras(
            leituras, periodo, inicioPeriodo, instanteConsulta
        ),
        [leituras, periodo, inicioPeriodo, instanteConsulta]
    );

    const pontosComparacao = useMemo(
        () => comparar
            ? consolidarLeituras(
                leiturasComparacao, periodo, inicioComparacao, fimComparacao
            )
            : [],
        [
            comparar, leiturasComparacao, periodo,
            inicioComparacao, fimComparacao
        ]
    );

    const pontosDisponiveis = useMemo(
        () => pontos.filter(ponto => ponto.quantidade > 0),
        [pontos]
    );
    const pontosComparacaoDisponiveis = useMemo(
        () => pontosComparacao.filter(ponto => ponto.quantidade > 0),
        [pontosComparacao]
    );

    // Sobreposição por posição no intervalo, sem misturar os instantes reais.
    const pontosGrafico: PontoGrafico[] = useMemo(
        () => Array.from({
            length: Math.max(pontos.length, pontosComparacao.length)
        }, (_, indice) => {
            const principal = pontos[indice];
            const segundo = pontosComparacao[indice];
            return {
                recebidoEm: principal?.recebidoEm ?? segundo?.recebidoEm ?? 0,
                momento: comparar && periodo === 'mes'
                    ? `Dia ${indice + 1}`
                    : principal?.momento ?? `Intervalo ${indice + 1}`,
                temperatura: principal?.temperatura ?? null,
                umidade: principal?.umidade ?? null,
                quantidade: principal?.quantidade ?? 0,
                temperaturaComparacao: segundo?.temperatura ?? null,
                umidadeComparacao: segundo?.umidade ?? null,
                momentoComparacao: segundo?.momento
            };
        }),
        [pontos, pontosComparacao]
    );


    const dadosDaSerie = (serie: 'a' | 'b') => {
        const eComparacao = serie === 'b';
        return {
            leituras: eComparacao ? leiturasComparacao : leituras,
            pontos: eComparacao ? pontosComparacaoDisponiveis : pontosDisponiveis,
            inicio: eComparacao ? inicioComparacao : inicioPeriodo,
            fim: eComparacao ? fimComparacao : instanteConsulta,
            parcial: eComparacao ? parcialComparacao : parcial
        };
    };

    const baixarCSV = (consolidado: boolean, serie: 'a' | 'b' = 'a') => {
        const dados = dadosDaSerie(serie);
        if (!estacao || carregando || erro || dados.leituras.length === 0 ||
            (serie === 'b' && (carregandoComparacao || erroComparacao))) return;

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
            ? dados.pontos.map(ponto => [
                formatarData(ponto.recebidoEm, true),
                ponto.temperatura!.toFixed(2).replace('.', ','),
                ponto.umidade!.toFixed(2).replace('.', ','),
                ponto.quantidade
            ].join(';'))
            : dados.leituras.map(leitura => [
                formatarDataCompleta(leitura.recebidoEm),
                leitura.temperatura.toFixed(2).replace('.', ','),
                leitura.umidade.toFixed(2).replace('.', ',')
            ].join(';'));

        const conteudo = '\uFEFF' + [
            cabecalho.join(';'),
            ...linhas
        ].join('\r\n');

        const url = URL.createObjectURL(new Blob(
            [conteudo], { type: 'text/csv;charset=utf-8;' }
        ));
        const link = document.createElement('a');
        link.href = url;
        link.download = `cuidai-historico-${periodo}-${serie}-${consolidado ? 'medias' : 'originais'}-${estacao.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.csv`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    };

    const gerarRelatorio = (serie: 'a' | 'b' = 'a') => {
        if (!estacao || carregando || erro ||
            (serie === 'b' && (carregandoComparacao || erroComparacao))) return;
        const dados = dadosDaSerie(serie);
        if (dados.pontos.length === 0) return;
        abrirRelatorioHistorico(
            estacao,
            dados.pontos.map(ponto => ({
                recebidoEm: ponto.recebidoEm,
                temperatura: ponto.temperatura!,
                umidade: ponto.umidade!
            })),
            {
                periodo: `${opcaoPeriodo.titulo} • série ${serie.toUpperCase()} • ${descricaoIntervalo(dados.inicio, dados.fim)}`,
                agregacao: opcaoPeriodo.descricao,
                totalMedicoes: dados.leituras.length,
                incompleto: dados.parcial
            }
        );
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
                                cache.current.clear();
                                if (seguindoAgora) {
                                    setInstanteConsulta(Date.now());
                                }
                                setRevisao(valor => valor + 1);
                            }}
                            disabled={carregando || carregandoComparacao}
                            aria-label="Atualizar histórico"
                            title="Consultar novamente as medições do período"
                        >
                            <FiRefreshCw aria-hidden="true" />
                            Atualizar
                        </button>
                    </div>

                    <div className="historico-periodo-opcoes"
                         role="group" aria-label="Escala do histórico">
                        {OPCOES_PERIODO.map(opcao => (
                            <button
                                key={opcao.id}
                                type="button"
                                aria-pressed={periodo === opcao.id}
                                className={periodo === opcao.id
                                    ? 'historico-periodo-botao historico-periodo-botao--ativo'
                                    : 'historico-periodo-botao'}
                                onClick={() => {
                                    const dataAtual = paraInputData(
                                        seguindoAgora ? Date.now() : instanteConsulta,
                                        opcao.id
                                    );
                                    const novoFim = lerDataSelecionada(dataAtual, opcao.id);
                                    if (novoFim !== null) {
                                        setInstanteConsulta(seguindoAgora ? Date.now() : novoFim);
                                    }
                                    if (comparar) {
                                        const dataB = paraInputData(fimComparacao, opcao.id);
                                        const novoB = lerDataSelecionada(dataB, opcao.id);
                                        if (novoB !== null) setInstanteComparacao(novoB);
                                    }
                                    setPeriodo(opcao.id);
                                }}
                            >
                                {opcao.titulo}
                            </button>
                        ))}
                    </div>

                    <div className="historico-navegacao">
                        <span className="historico-navegacao__rotulo">Período A</span>
                        <button type="button" className="historico-navegacao__seta"
                            onClick={() => navegarPeriodo(-1)}
                            aria-label="Voltar um intervalo"
                            title="Período anterior">
                            <FiChevronLeft />
                        </button>
                        <input
                            aria-label={periodo === 'hora'
                                ? 'Data e hora do período A'
                                : 'Data final do período A'}
                            type={periodo === 'hora' ? 'datetime-local' : periodo === 'mes' ? 'month' : 'date'}
                            max={paraInputData(Date.now(), periodo)}
                            value={paraInputData(instanteConsulta, periodo)}
                            onChange={evento => {
                                const instante = lerDataSelecionada(evento.target.value, periodo);
                                if (instante !== null) {
                                    setSeguindoAgora(instante >= Date.now() - 60 * 1000);
                                    setInstanteConsulta(instante);
                                }
                            }}
                        />
                        <button type="button" className="historico-navegacao__seta"
                            disabled={periodo === 'mes'
                                ? paraInputData(instanteConsulta, 'mes') === paraInputData(Date.now(), 'mes')
                                : instanteConsulta >= Date.now() - 60 * 1000}
                            onClick={() => navegarPeriodo(1)}
                            aria-label="Avançar um intervalo"
                            title="Próximo período">
                            <FiChevronRight />
                        </button>
                        <button type="button" className="historico-navegacao__atual"
                            onClick={() => {
                                setSeguindoAgora(true);
                                setInstanteConsulta(Date.now());
                            }}>
                            Agora
                        </button>
                    </div>
                    <p className="historico-periodo-descricao">
                        {opcaoPeriodo.descricao} • {descricaoIntervalo(inicioPeriodo, instanteConsulta)}
                    </p>

                    <button
                        type="button"
                        className={comparar
                            ? 'historico-comparar historico-comparar--ativo'
                            : 'historico-comparar'}
                        aria-pressed={comparar}
                        onClick={() => {
                            if (!comparar && instanteComparacao === null) {
                                setInstanteComparacao(
                                    periodoAnterior()
                                );
                            }
                            setComparar(valor => !valor);
                        }}
                    >
                        <FiGitMerge aria-hidden="true" />
                        {comparar ? 'Ocultar comparação' : 'Comparar com outro período'}
                    </button>

                    {comparar && (
                        <div className="historico-comparacao-seletor">
                            <label htmlFor="historico-data-comparacao">
                                Período B • comparação
                            </label>
                            <div className="historico-comparacao-seletor__linha">
                                <input
                                    id="historico-data-comparacao"
                                    type={periodo === 'hora' ? 'datetime-local' : periodo === 'mes' ? 'month' : 'date'}
                                    max={paraInputData(Date.now(), periodo)}
                                    value={paraInputData(fimComparacao, periodo)}
                                    onChange={evento => {
                                        const instante = lerDataSelecionada(
                                            evento.target.value, periodo
                                        );
                                        if (instante !== null) setInstanteComparacao(instante);
                                    }}
                                />
                                <button type="button"
                                    onClick={() => setInstanteComparacao(
                                        periodoAnterior()
                                    )}>
                                    Anterior
                                </button>
                            </div>
                            <p className="historico-periodo-descricao">
                                {descricaoIntervalo(inicioComparacao, fimComparacao)}
                            </p>
                        </div>
                    )}
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
            {!carregando && !erro && !carregandoComparacao &&
                leituras.length === 0 &&
                (!comparar || leiturasComparacao.length === 0) && (
                <article className="obs-bloco">
                    <h4>Sem medições no período</h4>
                    <p>Não foram encontradas leituras válidas no intervalo escolhido.</p>
                </article>
            )}

            {!carregando && !erro &&
                (leituras.length > 0 || (comparar &&
                    !carregandoComparacao && leiturasComparacao.length > 0)) && (
                <>
                    {parcial && (
                        <p className="historico-periodo-alerta" role="alert">
                            O limite de {MAXIMO_LEITURAS.toLocaleString('pt-BR')} leituras
                            foi alcançado. A consulta pode estar incompleta;
                            reduza o período para analisar todas as medições.
                        </p>
                    )}
                    {erroComparacao && (
                        <p className="historico-periodo-alerta" role="alert">
                            Não foi possível consultar o período B.
                            A série A continua disponível.
                        </p>
                    )}
                    {carregandoComparacao && (
                        <p className="historico-carregando-comparacao" role="status">
                            Consultando período B...
                        </p>
                    )}
                    {parcialComparacao && (
                        <p className="historico-periodo-alerta" role="alert">
                            A consulta do período B atingiu o limite de leituras;
                            a comparação pode estar incompleta.
                        </p>
                    )}
                    {comparar && !carregandoComparacao && !erroComparacao && (
                        <div className="historico-legenda-comparacao">
                            <span><i className="historico-legenda-comparacao__a" />
                                A • {descricaoIntervalo(inicioPeriodo, instanteConsulta)}</span>
                            <span><i className="historico-legenda-comparacao__b" />
                                B • {descricaoIntervalo(inicioComparacao, fimComparacao)}</span>
                        </div>
                    )}

                    {(pontosDisponiveis.length >= 2 ||
                        (comparar && pontosComparacaoDisponiveis.length >= 2)) ? (
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
                                            data={pontosGrafico}
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
                                                name={comparar ? 'Período A' : grafico.titulo}
                                                stroke={grafico.cor}
                                                strokeWidth={2.5}
                                                dot={pontosDisponiveis.length <= 12}
                                                connectNulls={false}
                                                isAnimationActive={true}
                                                animationDuration={650}
                                                activeDot={{ r: 5 }}
                                            />
                                            {comparar && !carregandoComparacao &&
                                                !erroComparacao && (
                                                <Line
                                                    type="monotone"
                                                    dataKey={`${grafico.campo}Comparacao`}
                                                    name="Período B"
                                                    stroke={grafico.campo === 'temperatura'
                                                        ? '#9D6B55'
                                                        : '#637C9B'}
                                                    strokeWidth={2}
                                                    strokeDasharray="5 4"
                                                    dot={false}
                                                    connectNulls={false}
                                                    isAnimationActive={false}
                                                    activeDot={{ r: 4 }}
                                                />
                                            )}
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

                    <div className="historico-resumo historico-resumo--rodape">
                        <div className="historico-resumo--rodape__informacoes">
                            <div className="historico-resumo-total">
                                <FiDatabase aria-hidden="true" />
                                <strong>
                                    A: {leituras.length.toLocaleString('pt-BR')} medições
                                </strong>
                                <span className="historico-periodo-resumo">
                                    {pontosDisponiveis.length} intervalos
                                </span>
                            </div>
                            {comparar && (
                                <div className="historico-resumo-total">
                                    <FiGitMerge aria-hidden="true" />
                                    <strong>
                                        B: {leiturasComparacao.length.toLocaleString('pt-BR')} medições
                                    </strong>
                                    <span className="historico-periodo-resumo">
                                        {pontosComparacaoDisponiveis.length} intervalos
                                    </span>
                                </div>
                            )}
                            <div className="historico-resumo-periodo">
                                <FiClock aria-hidden="true" />
                                <span>
                                    {descricaoIntervalo(inicioPeriodo, instanteConsulta)}
                                </span>
                            </div>
                        </div>

                        <details className="historico-exportacao">
                            <summary>
                                <FiDownload aria-hidden="true" />
                                Exportar
                                <span aria-hidden="true">▾</span>
                            </summary>
                            <div className="historico-exportacao-opcoes">
                                {leituras.length > 0 && (
                                    <>
                                        <button type="button" onClick={() => gerarRelatorio('a')}>
                                            <FiPrinter aria-hidden="true" />
                                            Relatório A (PDF)
                                        </button>
                                        <button type="button" onClick={() => baixarCSV(true, 'a')}>
                                            <FiDownload aria-hidden="true" />
                                            Médias A (CSV)
                                        </button>
                                        <button type="button" onClick={() => baixarCSV(false, 'a')}>
                                            <FiDownload aria-hidden="true" />
                                            Medições A (CSV)
                                        </button>
                                    </>
                                )}
                                {comparar && !carregandoComparacao &&
                                    !erroComparacao && leiturasComparacao.length > 0 && (
                                    <>
                                        <button type="button" onClick={() => gerarRelatorio('b')}>
                                            <FiPrinter aria-hidden="true" />
                                            Relatório B (PDF)
                                        </button>
                                        <button type="button" onClick={() => baixarCSV(true, 'b')}>
                                            <FiDownload aria-hidden="true" />
                                            Médias B (CSV)
                                        </button>
                                        <button type="button" onClick={() => baixarCSV(false, 'b')}>
                                            <FiDownload aria-hidden="true" />
                                            Medições B (CSV)
                                        </button>
                                    </>
                                )}
                            </div>
                        </details>
                    </div>

                    <p className="historico-fonte">
                        Fonte: Estação CUIDAÍ • Dados medidos pelos sensores,
                        não estimativas da Open-Meteo.
                        Os gráficos apresentam médias das medições disponíveis
                        em cada intervalo; horários sem dados permanecem vazios.
                        As duas séries comparadas usam a mesma escala de tempo
                        relativo, em datas diferentes. A exportação identifica
                        cada período e diferencia médias de medições originais.
                    </p>
                </>
            )}
        </div>
    );
}
