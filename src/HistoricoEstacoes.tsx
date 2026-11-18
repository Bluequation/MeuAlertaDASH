
import { useEffect, useMemo, useRef, useState } from 'react';
import {
    collection,
    getDocs,
    limit,
    onSnapshot,
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
    FiGitMerge,
    FiRadio,
    FiCloud,
    FiTrendingUp
} from 'react-icons/fi';
import { db } from './firebase';
import { abrirRelatorioHistorico } from './RelatorioHistorico';
import { consultarHistoricoOpenMeteo, type AmostraOpenMeteo } from './openMeteoHistorico';
import type { EstacaoPublica } from './estacoesMunicipais';

type Leitura = {
    id: string;
    temperatura: number;
    umidade: number;
    recebidoEm: number;
};

type Periodo = 'hora' | 'dia' | 'semana' | 'mes';
type ModoHistorico = 'ao-vivo' | 'historico';

type PontoConsolidado = {
    recebidoEm: number;
    momento: string;
    temperatura: number | null;
    umidade: number | null;
    temperaturaMinima: number | null;
    temperaturaMaxima: number | null;
    umidadeMinima: number | null;
    umidadeMaxima: number | null;
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
        temperaturaMinima: number;
        temperaturaMaxima: number;
        umidadeMinima: number;
        umidadeMaxima: number;
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
            temperaturaMinima: Number.POSITIVE_INFINITY,
            temperaturaMaxima: Number.NEGATIVE_INFINITY,
            umidadeMinima: Number.POSITIVE_INFINITY,
            umidadeMaxima: Number.NEGATIVE_INFINITY,
            quantidade: 0
        };
        anterior.somaTemperatura += leitura.temperatura;
        anterior.somaUmidade += leitura.umidade;
        anterior.temperaturaMinima = Math.min(anterior.temperaturaMinima, leitura.temperatura);
        anterior.temperaturaMaxima = Math.max(anterior.temperaturaMaxima, leitura.temperatura);
        anterior.umidadeMinima = Math.min(anterior.umidadeMinima, leitura.umidade);
        anterior.umidadeMaxima = Math.max(anterior.umidadeMaxima, leitura.umidade);
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
            temperaturaMinima: dados?.temperaturaMinima ?? null,
            temperaturaMaxima: dados?.temperaturaMaxima ?? null,
            umidadeMinima: dados?.umidadeMinima ?? null,
            umidadeMaxima: dados?.umidadeMaxima ?? null,
            quantidade: dados?.quantidade ?? 0
        });
    }

    return pontos;
}


type ResultadoConsulta = { leituras: Leitura[]; parcial: boolean };
type PontoGrafico = PontoConsolidado & {
    temperaturaComparacao: number | null;
    umidadeComparacao: number | null;
    temperaturaOpenMeteo: number | null;
    umidadeOpenMeteo: number | null;
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
    const [modo, setModo] = useState<ModoHistorico>('ao-vivo');
    const aoVivo = modo === 'ao-vivo';
    const [periodo, setPeriodo] = useState<Periodo>('hora');
    const [instanteConsulta, setInstanteConsulta] = useState(Date.now);
    const [instanteAoVivo, setInstanteAoVivo] = useState(Date.now);
    const [seguindoAgora, setSeguindoAgora] = useState(true);
    const [comparar, setComparar] = useState(false);
    const [instanteComparacao, setInstanteComparacao] =
        useState<number | null>(null);
    const [revisao, setRevisao] = useState(0);
    const [mostrarOpenMeteo, setMostrarOpenMeteo] = useState(false);
    const [mostrarExtremos, setMostrarExtremos] = useState(false);
    const [amostrasOpenMeteo, setAmostrasOpenMeteo] = useState<AmostraOpenMeteo[]>([]);
    const [carregandoOpenMeteo, setCarregandoOpenMeteo] = useState(false);
    const [erroOpenMeteo, setErroOpenMeteo] = useState<string | null>(null);

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

    // Modo Ao vivo: restaura a série original, com as últimas 72
    // medições individuais e atualização automática pelo Firestore.
    useEffect(() => {
        if (!aoVivo) return;
        setLeituras([]);
        setErro(null);
        setParcial(false);
        setCarregando(true);
        if (!idConsulta) {
            setCarregando(false);
            return;
        }

        const consulta = query(
            collection(db, 'estacoesMeteorologicas', idConsulta, 'leituras'),
            orderBy('recebidoEm', 'desc'),
            limit(72)
        );
        return onSnapshot(consulta, snapshot => {
            const agora = Date.now();
            setInstanteAoVivo(agora);
            const recentes: Leitura[] = [];
            snapshot.forEach(documento => {
                const dados = documento.data();
                const instante = typeof dados.recebidoEm?.toMillis === 'function'
                    ? dados.recebidoEm.toMillis()
                    : dados.recebidoEm;
                if (
                    typeof dados.temperatura !== 'number' ||
                    !Number.isFinite(dados.temperatura) ||
                    dados.temperatura < -50 || dados.temperatura > 70 ||
                    typeof dados.umidade !== 'number' ||
                    !Number.isFinite(dados.umidade) ||
                    dados.umidade < 0 || dados.umidade > 100 ||
                    typeof instante !== 'number' ||
                    !Number.isFinite(instante) ||
                    instante <= 0 || instante > agora + 300000
                ) return;
                recentes.push({
                    id: documento.id,
                    temperatura: dados.temperatura,
                    umidade: dados.umidade,
                    recebidoEm: instante
                });
            });
            recentes.sort((a, b) => a.recebidoEm - b.recebidoEm);
            setLeituras(recentes);
            setErro(null);
            setCarregando(false);
        }, falha => {
            console.error('Erro ao acompanhar estação ao vivo:', falha);
            setErro('Não foi possível acompanhar as leituras ao vivo.');
            setCarregando(false);
        });
    }, [aoVivo, idConsulta]);

    useEffect(() => {
        if (aoVivo) return;
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
        comparar, inicioComparacao, fimComparacao, revisao, aoVivo
    ]);

    // Fonte secundária legítima: a última medição publicada no documento da
    // estação. Usada se a subcoleção ainda não contiver a leitura mais recente.
    const leiturasAoVivo = useMemo<Leitura[]>(() => {
        if (!aoVivo) return leituras;
        const ultima = estacao?.ultimaLeitura;
        if (!ultima || !Number.isFinite(ultima.recebidoEm) ||
            !Number.isFinite(ultima.temperatura) ||
            !Number.isFinite(ultima.umidade)) return leituras;
        const registros = [...leituras];
        if (!registros.some(item =>
            Math.abs(item.recebidoEm - ultima.recebidoEm) < 30_000
        )) {
            registros.push({
                id: `ultima-publicada-${estacao?.id ?? ''}`,
                temperatura: ultima.temperatura,
                umidade: ultima.umidade,
                recebidoEm: ultima.recebidoEm
            });
            registros.sort((a, b) => a.recebidoEm - b.recebidoEm);
        }
        return registros.slice(-72);
    }, [
        aoVivo, leituras, estacao?.id,
        estacao?.ultimaLeitura?.recebidoEm,
        estacao?.ultimaLeitura?.temperatura,
        estacao?.ultimaLeitura?.umidade
    ]);

    // Ao vivo: mostra as últimas medições reais, mesmo se a estação
    // estiver temporariamente offline. Open-Meteo não controla essa janela.
    const ultimaLeituraAoVivo = aoVivo
        ? leiturasAoVivo[leiturasAoVivo.length - 1] : null;
    const inicioVisualizacao = aoVivo
        ? (leiturasAoVivo[0]?.recebidoEm ?? instanteAoVivo - 2 * HORA)
        : inicioPeriodo;
    const fimVisualizacao = aoVivo
        ? Math.max(
            ultimaLeituraAoVivo?.recebidoEm ?? instanteAoVivo,
            inicioVisualizacao + 60_000
        )
        : instanteConsulta;
    const ultimaLeituraRecente = !!ultimaLeituraAoVivo &&
        instanteAoVivo >= ultimaLeituraAoVivo.recebidoEm &&
        instanteAoVivo - ultimaLeituraAoVivo.recebidoEm <= 30 * 60_000;

    const pontos = useMemo<PontoConsolidado[]>(() => {
        if (!aoVivo) {
            return consolidarLeituras(
                leituras, periodo, inicioVisualizacao, fimVisualizacao
            );
        }

        // Não reamostra as medições ao vivo e não une falhas de transmissão.
        const serie: PontoConsolidado[] = [];
        const ponto = (horario: number, leitura?: Leitura): PontoConsolidado => ({
            recebidoEm: horario,
            momento: formatarPonto(horario, 'hora'),
            temperatura: leitura?.temperatura ?? null,
            umidade: leitura?.umidade ?? null,
            temperaturaMinima: leitura?.temperatura ?? null,
            temperaturaMaxima: leitura?.temperatura ?? null,
            umidadeMinima: leitura?.umidade ?? null,
            umidadeMaxima: leitura?.umidade ?? null,
            quantidade: leitura ? 1 : 0
        });
        leiturasAoVivo.forEach((leitura, indice) => {
            const anterior = leiturasAoVivo[indice - 1];
            if (anterior && leitura.recebidoEm - anterior.recebidoEm > 3 * 60_000) {
                serie.push(ponto((anterior.recebidoEm + leitura.recebidoEm) / 2));
            }
            serie.push(ponto(leitura.recebidoEm, leitura));
        });
        return serie;
    }, [
        leituras, leiturasAoVivo, aoVivo, periodo,
        inicioVisualizacao, fimVisualizacao
    ]);

    const pontosComparacao = useMemo(
        () => !aoVivo && comparar
            ? consolidarLeituras(
                leiturasComparacao, periodo, inicioComparacao, fimComparacao
            )
            : [],
        [
            aoVivo, comparar, leiturasComparacao, periodo,
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

    // A verificação de atualidade da estação é independente da Open-Meteo.
    useEffect(() => {
        if (!aoVivo) return;
        const timer = window.setInterval(() => {
            setInstanteAoVivo(Date.now());
        }, 60_000);
        return () => window.clearInterval(timer);
    }, [aoVivo]);

    // Busca horas vizinhas para possibilitar a comparação visual com as
    // medições minuto a minuto, sem sintetizar medições do sensor.
    const inicioConsultaMeteo = aoVivo
        ? Math.floor(inicioVisualizacao / HORA) * HORA - 2 * HORA
        : inicioPeriodo - 2 * HORA;
    const fimConsultaMeteo = aoVivo
        ? Math.ceil(fimVisualizacao / HORA) * HORA + 2 * HORA
        : instanteConsulta + 2 * HORA;
    const chaveJanelaMeteo = aoVivo
        ? `${Math.floor(inicioVisualizacao / HORA)}:${Math.floor(fimVisualizacao / HORA)}`
        : 'historico';

    useEffect(() => {
        if (!mostrarOpenMeteo || !estacao) {
            setAmostrasOpenMeteo([]);
            setCarregandoOpenMeteo(false);
            setErroOpenMeteo(null);
            return;
        }

        const controlador = new AbortController();
        const inicio = inicioConsultaMeteo;
        const fim = fimConsultaMeteo;
        setCarregandoOpenMeteo(true);
        setErroOpenMeteo(null);
        // Mantém a série anterior visível enquanto renova os dados.
        void consultarHistoricoOpenMeteo(
            estacao.latitude, estacao.longitude,
            inicio, fim, controlador.signal
        ).then(amostras => {
            if (!controlador.signal.aborted) setAmostrasOpenMeteo(amostras);
        }).catch(falha => {
            if (!controlador.signal.aborted) {
                console.error('Open-Meteo:', falha);
                setErroOpenMeteo('Estimativas Open-Meteo indisponíveis.');
                setAmostrasOpenMeteo([]);
            }
        }).finally(() => {
            if (!controlador.signal.aborted) setCarregandoOpenMeteo(false);
        });
        return () => controlador.abort();
    }, [
        aoVivo, mostrarOpenMeteo, estacao?.id,
        estacao?.latitude, estacao?.longitude,
        inicioPeriodo, instanteConsulta, chaveJanelaMeteo
    ]);

    const pontosOpenMeteo = useMemo(() => {
        const dados = amostrasOpenMeteo.map((item, indice) => ({
            ...item,
            id: String(indice)
        }));
        if (!aoVivo && periodo === 'mes') {
            return consolidarLeituras(
                dados, periodo, inicioVisualizacao, fimVisualizacao
            ).filter(ponto => ponto.quantidade > 0);
        }
        // Preserva as horas vizinhas para interpolação visual do modelo.
        return dados.map(amostra => ({
            ...amostra,
            momento: formatarPonto(amostra.recebidoEm, aoVivo ? 'hora' : periodo),
            temperaturaMinima: amostra.temperatura,
            temperaturaMaxima: amostra.temperatura,
            umidadeMinima: amostra.umidade,
            umidadeMaxima: amostra.umidade,
            quantidade: 1
        }));
    }, [
        amostrasOpenMeteo, aoVivo, periodo,
        inicioVisualizacao, fimVisualizacao
    ]);

    // Modelo horário interpolado SOMENTE para desenhar sua linha.
    // Os valores reais da estação continuam sem qualquer interpolação.
    const pontosGrafico = useMemo<PontoGrafico[]>(() => {
        const modelo = mostrarOpenMeteo && !erroOpenMeteo
            ? pontosOpenMeteo
            : [];
        const lerModeloNoHorario = (instante: number) => {
            if (modelo.length === 0) return null;
            const posterior = modelo.findIndex(item => item.recebidoEm >= instante);
            if (posterior < 0) return null;
            const seguinte = modelo[posterior];
            if (seguinte.recebidoEm === instante) return seguinte;
            const anterior = modelo[posterior - 1];
            if (!anterior) return null;

            // A série mensal pode conter intervalos vazios. Interpolamos
            // somente estimativas numéricas válidas, nunca valores ausentes.
            const temperaturaAnterior = anterior.temperatura;
            const temperaturaSeguinte = seguinte.temperatura;
            const umidadeAnterior = anterior.umidade;
            const umidadeSeguinte = seguinte.umidade;
            if (
                typeof temperaturaAnterior !== 'number' ||
                typeof temperaturaSeguinte !== 'number' ||
                typeof umidadeAnterior !== 'number' ||
                typeof umidadeSeguinte !== 'number' ||
                !Number.isFinite(temperaturaAnterior) ||
                !Number.isFinite(temperaturaSeguinte) ||
                !Number.isFinite(umidadeAnterior) ||
                !Number.isFinite(umidadeSeguinte)
            ) return null;

            const intervalo = seguinte.recebidoEm - anterior.recebidoEm;
            if (intervalo <= 0 || intervalo > 2 * HORA) return null;
            const fracao = (instante - anterior.recebidoEm) / intervalo;
            return {
                temperatura: temperaturaAnterior +
                    (temperaturaSeguinte - temperaturaAnterior) * fracao,
                umidade: umidadeAnterior +
                    (umidadeSeguinte - umidadeAnterior) * fracao
            };
        };

        const principal = pontos.length > 0
            ? pontos
            : modelo.filter(amostra =>
                amostra.recebidoEm >= inicioVisualizacao &&
                amostra.recebidoEm <= fimVisualizacao
            ).map(amostra => ({
                ...amostra,
                temperatura: null,
                umidade: null,
                temperaturaMinima: null,
                temperaturaMaxima: null,
                umidadeMinima: null,
                umidadeMaxima: null,
                quantidade: 0
            }));

        return principal.map((ponto, indice) => {
            const segundo = pontosComparacao[indice];
            const meteo = lerModeloNoHorario(ponto.recebidoEm);
            return {
                ...ponto,
                momento: !aoVivo && comparar && periodo === 'mes'
                    ? `Dia ${indice + 1}`
                    : ponto.momento,
                temperaturaComparacao: segundo?.temperatura ?? null,
                umidadeComparacao: segundo?.umidade ?? null,
                temperaturaOpenMeteo: meteo?.temperatura ?? null,
                umidadeOpenMeteo: meteo?.umidade ?? null,
                momentoComparacao: segundo?.momento
            };
        });
    }, [
        pontos, pontosComparacao, pontosOpenMeteo,
        mostrarOpenMeteo, erroOpenMeteo, aoVivo,
        comparar, periodo, inicioVisualizacao, fimVisualizacao
    ]);

    const resumoCampo = (campo: 'temperatura' | 'umidade') => {
        const registros = aoVivo
            ? leiturasAoVivo.filter(leitura =>
                leitura.recebidoEm >= inicioVisualizacao &&
                leitura.recebidoEm <= fimVisualizacao
            )
            : leituras;
        if (registros.length === 0) return null;
        let soma = 0;
        let minimo = Number.POSITIVE_INFINITY;
        let maximo = Number.NEGATIVE_INFINITY;
        for (const leitura of registros) {
            const valor = leitura[campo];
            soma += valor;
            minimo = Math.min(minimo, valor);
            maximo = Math.max(maximo, valor);
        }
        return {
            minimo,
            medio: soma / registros.length,
            maximo
        };
    };

    const dominioCompartilhado = (campo: 'temperatura' | 'umidade'): [number, number] => {
        const valores = [
            ...pontosGrafico.map(p => p[campo]),
            ...pontosGrafico.map(p => p[`${campo}Comparacao` as keyof PontoGrafico]),
            ...(!aoVivo && mostrarExtremos
                ? pontosGrafico.flatMap(p => [
                    p[`${campo}Minima` as keyof PontoGrafico],
                    p[`${campo}Maxima` as keyof PontoGrafico]
                ])
                : []),
            ...(mostrarOpenMeteo && !erroOpenMeteo
                ? pontosOpenMeteo
                    .filter(p => p.recebidoEm >= inicioVisualizacao &&
                        p.recebidoEm <= fimVisualizacao)
                    .map(p => p[campo])
                : [])
        ].filter((valor): valor is number =>
            typeof valor === 'number' && Number.isFinite(valor)
        );
        if (valores.length === 0) return campo === 'umidade' ? [0, 100] : [20, 40];
        const minimo = Math.min(...valores);
        const maximo = Math.max(...valores);
        const margem = Math.max(campo === 'temperatura' ? 0.5 : 2, (maximo - minimo) * 0.1);
        return campo === 'umidade'
            ? [Math.max(0, minimo - margem), Math.min(100, maximo + margem)]
            : [minimo - margem, maximo + margem];
    };

    const dadosDaSerie = (serie: 'a' | 'b') => {
        const eComparacao = serie === 'b';
        return {
            leituras: eComparacao
                ? leiturasComparacao
                : aoVivo ? leiturasAoVivo : leituras,
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
                'Temperatura mínima (°C)',
                'Temperatura máxima (°C)',
                'Umidade média (%)',
                'Umidade mínima (%)',
                'Umidade máxima (%)',
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
                ponto.temperaturaMinima!.toFixed(2).replace('.', ','),
                ponto.temperaturaMaxima!.toFixed(2).replace('.', ','),
                ponto.umidade!.toFixed(2).replace('.', ','),
                ponto.umidadeMinima!.toFixed(2).replace('.', ','),
                ponto.umidadeMaxima!.toFixed(2).replace('.', ','),
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

    const baixarOpenMeteoCSV = () => {
        if (carregandoOpenMeteo || erroOpenMeteo ||
            amostrasOpenMeteo.length === 0 || !estacao) return;
        const conteudo = '\uFEFF' + [
            'Fonte;Data e hora (Fortaleza);Temperatura estimada (°C);Umidade estimada (%)',
            ...amostrasOpenMeteo.map(amostra => [
                'Open-Meteo (modelo)',
                formatarDataCompleta(amostra.recebidoEm),
                amostra.temperatura.toFixed(2).replace('.', ','),
                amostra.umidade.toFixed(2).replace('.', ',')
            ].join(';'))
        ].join('\r\n');
        const url = URL.createObjectURL(new Blob(
            [conteudo], { type: 'text/csv;charset=utf-8;' }
        ));
        const link = document.createElement('a');
        link.href = url;
        link.download = `cuidai-open-meteo-${periodo}-${estacao.id.replace(/[^a-zA-Z0-9_-]/g, '-')}.csv`;
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
        if (aoVivo) {
            abrirRelatorioHistorico(
                estacao,
                dados.leituras.map(leitura => ({
                    recebidoEm: leitura.recebidoEm,
                    temperatura: leitura.temperatura,
                    umidade: leitura.umidade
                }))
            );
            return;
        }

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
                incompleto: dados.parcial,
                resumoMedicoes: dados.leituras.length > 0 ? {
                    temperaturaMinima: Math.min(
                        ...dados.leituras.map(leitura => leitura.temperatura)
                    ),
                    temperaturaMaxima: Math.max(
                        ...dados.leituras.map(leitura => leitura.temperatura)
                    ),
                    temperaturaMedia: dados.leituras.reduce(
                        (soma, leitura) => soma + leitura.temperatura, 0
                    ) / dados.leituras.length,
                    umidadeMedia: dados.leituras.reduce(
                        (soma, leitura) => soma + leitura.umidade, 0
                    ) / dados.leituras.length
                } : undefined
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


                <div className="historico-modos" role="group"
                    aria-label="Visualização das medições">
                    <button type="button"
                        className={aoVivo
                            ? 'historico-modos__botao historico-modos__botao--ativo'
                            : 'historico-modos__botao'}
                        aria-pressed={aoVivo}
                        onClick={() => {
                            setModo('ao-vivo');
                            setComparar(false);
                        }}>
                        <FiRadio aria-hidden="true" />
                        Ao vivo
                    </button>
                    <button type="button"
                        className={!aoVivo
                            ? 'historico-modos__botao historico-modos__botao--ativo'
                            : 'historico-modos__botao'}
                        aria-pressed={!aoVivo}
                        onClick={() => {
                            setInstanteConsulta(Date.now());
                            setSeguindoAgora(true);
                            setModo('historico');
                        }}>
                        <FiClock aria-hidden="true" />
                        Histórico
                    </button>
                </div>
                <div className="historico-meteo-controle">
                    <button
                        type="button"
                        className={mostrarOpenMeteo
                            ? 'historico-analise-botao historico-analise-botao--ativo'
                            : 'historico-analise-botao'}
                        aria-pressed={mostrarOpenMeteo}
                        onClick={() => setMostrarOpenMeteo(atual => !atual)}
                    >
                        <FiCloud aria-hidden="true" />
                        {mostrarOpenMeteo ? 'Ocultar Open-Meteo' : 'Mostrar Open-Meteo'}
                    </button>
                    {mostrarOpenMeteo && (
                        <span role="status">
                            {carregandoOpenMeteo
                                ? 'Consultando estimativas...'
                                : erroOpenMeteo
                                    ? erroOpenMeteo
                                    : amostrasOpenMeteo.length
                                        ? 'Estimativas horárias no mesmo gráfico'
                                        : 'Sem estimativas neste intervalo'}
                        </span>
                    )}
                </div>
                {aoVivo ? (
                    <p className="historico-modos__ao-vivo" role="status">
                        <span className={ultimaLeituraRecente
                            ? 'historico-modos__indicador'
                            : 'historico-modos__indicador historico-modos__indicador--sem-leitura'}
                            aria-hidden="true" />
                        {ultimaLeituraAoVivo
                            ? ultimaLeituraRecente
                                ? 'Atualizando • últimas medições da estação'
                                : `Última medição ${formatarData(ultimaLeituraAoVivo.recebidoEm, true)} • sem transmissão recente`
                            : 'Aguardando medições da estação'}
                    </p>
                ) : (
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

                    <div className="historico-opcoes-analise">
                        <button
                            type="button"
                            className={mostrarExtremos
                                ? 'historico-analise-botao historico-analise-botao--ativo'
                                : 'historico-analise-botao'}
                            aria-pressed={mostrarExtremos}
                            onClick={() => setMostrarExtremos(atual => !atual)}
                        >
                            <FiTrendingUp aria-hidden="true" />
                            {mostrarExtremos ? 'Ocultar mín./máx.' : 'Mostrar mín./máx.'}
                        </button>
                    </div>
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
                )}
            </article>

            {carregando && (
                <article className="obs-bloco">
                    <p role="status">
                        {aoVivo ? 'Carregando medições ao vivo...'
                            : `Consultando medições de ${opcaoPeriodo.titulo.toLowerCase()}...`}
                    </p>
                </article>
            )}
            {erro && (
                <article className="obs-bloco">
                    <p role="alert">{erro}</p>
                </article>
            )}
            {!carregando && !erro && !carregandoComparacao &&
                (aoVivo ? leiturasAoVivo.length === 0 : leituras.length === 0) &&
                (!comparar || leiturasComparacao.length === 0) &&
                (!mostrarOpenMeteo || (!carregandoOpenMeteo && amostrasOpenMeteo.length === 0)) && (
                <article className="obs-bloco">
                    <h4>Sem medições no período</h4>
                    <p>Não foram encontradas leituras válidas no intervalo escolhido.</p>
                </article>
            )}

            {!carregando && !erro &&
                ((aoVivo ? leiturasAoVivo.length > 0 : leituras.length > 0) ||
                    (mostrarOpenMeteo && amostrasOpenMeteo.length > 0) ||
                    (!aoVivo && comparar && !carregandoComparacao &&
                        leiturasComparacao.length > 0)) && (
                <>
                    {aoVivo && leiturasAoVivo.length === 0 && (
                        <p className="historico-periodo-alerta" role="status">
                            A estação ainda não possui medições para desenhar a linha.
                            Se a Open-Meteo estiver ligada, somente suas estimativas aparecerão.
                        </p>
                    )}
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
                    {!aoVivo && comparar && !carregandoComparacao && !erroComparacao && (
                        <div className="historico-legenda-comparacao">
                            <span><i className="historico-legenda-comparacao__a" />
                                A • {descricaoIntervalo(inicioPeriodo, instanteConsulta)}</span>
                            <span><i className="historico-legenda-comparacao__b" />
                                B • {descricaoIntervalo(inicioComparacao, fimComparacao)}</span>
                        </div>
                    )}

                    {(pontosDisponiveis.length >= 1 ||
                        (mostrarOpenMeteo && pontosOpenMeteo.length > 0) ||
                        (!aoVivo && comparar && pontosComparacaoDisponiveis.length >= 2)) ? (
                        ([
                            {
                                campo: 'temperatura',
                                titulo: aoVivo ? 'Temperatura • ao vivo' : 'Evolução da temperatura média',
                                unidade: '°C',
                                cor: '#DC7A40'
                            },
                            {
                                campo: 'umidade',
                                titulo: aoVivo ? 'Umidade • ao vivo' : 'Evolução da umidade média',
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
                                {mostrarOpenMeteo && (
                                    <div className="historico-legenda-fontes" aria-label="Fontes do gráfico">
                                        <span><i style={{ borderColor: grafico.cor }} /> Estação CUIDAÍ</span>
                                        <span><i className="historico-legenda-fontes__meteo" /> Open-Meteo • modelo horário</span>
                                    </div>
                                )}
                                {resumoCampo(grafico.campo) && (
                                    <div className="historico-resumo-extremos">
                                        <span>Mín. <b>{resumoCampo(grafico.campo)!.minimo.toFixed(1).replace('.', ',')} {grafico.unidade}</b></span>
                                        <span>Méd. <b>{resumoCampo(grafico.campo)!.medio.toFixed(1).replace('.', ',')} {grafico.unidade}</b></span>
                                        <span>Máx. <b>{resumoCampo(grafico.campo)!.maximo.toFixed(1).replace('.', ',')} {grafico.unidade}</b></span>
                                    </div>
                                )}

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
                                                dataKey="recebidoEm"
                                                type="number"
                                                scale="time"
                                                domain={[inicioVisualizacao, fimVisualizacao]}
                                                tickFormatter={(valor: number) =>
                                                    formatarPonto(valor, aoVivo ? 'hora' : periodo)}
                                                minTickGap={34}
                                                tick={{ fontSize: 10 }}
                                            />
                                            <YAxis
                                                domain={mostrarOpenMeteo
                                                    ? dominioCompartilhado(grafico.campo)
                                                    : ['auto', 'auto']}
                                                tick={{ fontSize: 11 }}
                                            />
                                            <Tooltip
                                                labelFormatter={instante =>
                                                    formatarData(Number(instante), true)}
                                                formatter={valor =>
                                                    `${Number(valor).toFixed(1).replace('.', ',')} ${grafico.unidade}`
                                                }
                                            />
                                            <Line
                                                type="monotone"
                                                dataKey={grafico.campo}
                                                name={!aoVivo && comparar ? 'Período A' : grafico.titulo}
                                                stroke={grafico.cor}
                                                strokeWidth={2.5}
                                                dot={aoVivo
                                                    ? { r: 1.35, strokeWidth: 0 }
                                                    : pontosDisponiveis.length <= 12}
                                                connectNulls={false}
                                                isAnimationActive={true}
                                                animationDuration={650}
                                                activeDot={{ r: 5 }}
                                            />
                                            {!aoVivo && mostrarExtremos && (
                                                <>
                                                    <Line
                                                        type="monotone"
                                                        dataKey={`${grafico.campo}Minima`}
                                                        name="Mínima no intervalo"
                                                        stroke={grafico.cor}
                                                        strokeOpacity={0.5}
                                                        strokeWidth={1.2}
                                                        strokeDasharray="3 4"
                                                        dot={false}
                                                        connectNulls={false}
                                                        isAnimationActive={false}
                                                    />
                                                    <Line
                                                        type="monotone"
                                                        dataKey={`${grafico.campo}Maxima`}
                                                        name="Máxima no intervalo"
                                                        stroke={grafico.cor}
                                                        strokeOpacity={0.5}
                                                        strokeWidth={1.2}
                                                        strokeDasharray="3 4"
                                                        dot={false}
                                                        connectNulls={false}
                                                        isAnimationActive={false}
                                                    />
                                                </>
                                            )}
                                            {!aoVivo && comparar && !carregandoComparacao &&
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
                                            {mostrarOpenMeteo && !erroOpenMeteo && (
                                                <Line
                                                    type="monotone"
                                                    dataKey={`${grafico.campo}OpenMeteo`}
                                                    name="Open-Meteo (modelo horário)"
                                                    stroke="#64748B"
                                                    strokeWidth={2}
                                                    strokeDasharray="5 4"
                                                    dot={{ r: 2.5 }}
                                                    activeDot={{ r: 4 }}
                                                    connectNulls={true}
                                                    isAnimationActive={false}
                                                />
                                            )}
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>

                            </article>
                        ))
                    ) : (
                        <article className="obs-bloco">
                            <p>Há dados insuficientes para traçar a evolução neste período.</p>
                        </article>
                    )}

                    <div className="historico-resumo historico-resumo--rodape">
                        <div className="historico-resumo--rodape__informacoes">
                            <div className="historico-resumo-total">
                                <FiDatabase aria-hidden="true" />
                                <strong>
                                    {aoVivo ? '' : 'A: '}
                                    {(aoVivo ? leiturasAoVivo.length : leituras.length).toLocaleString('pt-BR')} medições
                                </strong>
                                <span className="historico-periodo-resumo">
                                    {aoVivo ? 'atualização automática'
                                        : `${pontosDisponiveis.length} intervalos`}
                                </span>
                            </div>
                            {!aoVivo && comparar && (
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
                                    {aoVivo && leiturasAoVivo.length > 0
                                        ? descricaoIntervalo(
                                            leiturasAoVivo[0].recebidoEm,
                                            leiturasAoVivo[leiturasAoVivo.length - 1].recebidoEm
                                        )
                                        : descricaoIntervalo(inicioPeriodo, instanteConsulta)}
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
                                            {aoVivo ? 'Relatório (PDF)' : 'Relatório A (PDF)'}
                                        </button>
                                        {!aoVivo && (
                                            <button type="button" onClick={() => baixarCSV(true, 'a')}>
                                                <FiDownload aria-hidden="true" />
                                                Médias A (CSV)
                                            </button>
                                        )}
                                        <button type="button" onClick={() => baixarCSV(false, 'a')}>
                                            <FiDownload aria-hidden="true" />
                                            {aoVivo ? 'Medições (CSV)' : 'Medições A (CSV)'}
                                        </button>
                                    </>
                                )}
                                {mostrarOpenMeteo &&
                                    !carregandoOpenMeteo && !erroOpenMeteo &&
                                    amostrasOpenMeteo.length > 0 && (
                                    <button type="button" onClick={baixarOpenMeteoCSV}>
                                        <FiDownload aria-hidden="true" />
                                        Estimativas Open-Meteo (CSV)
                                    </button>
                                )}
                                {!aoVivo && comparar && !carregandoComparacao &&
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
                        {aoVivo
                            ? 'O gráfico se atualiza automaticamente com as medições individuais recentes.'
                            : 'No histórico, os gráficos apresentam médias por intervalo, sem preencher horários sem dados.'}
                        {!aoVivo && comparar
                            ? ' As séries A e B usam a mesma escala de tempo relativo, em datas diferentes.'
                            : ''}
                        {!aoVivo
                            ? ' Os arquivos exportados diferenciam médias e medições originais.'
                            : ''}
                        {mostrarOpenMeteo
                            ? ' Open-Meteo: estimativas de modelo para a coordenada da estação, interpoladas visualmente entre horas para comparação no mesmo gráfico. Não são medições locais.'
                            : ''}
                    </p>
                </>
            )}
        </div>
    );
}
