
import { useEffect, useState } from 'react';
import { consultarOpenMeteoComCache } from './openMeteoCache';
import type {
    Geometry,
    FeatureCollection
} from 'geojson';
import HistoricoEstacoes from './HistoricoEstacoes';
import type {
    EstacaoPublica
} from './estacoesMunicipais';
import ComparacaoMunicipal from './ComparacaoMunicipal';
import {
    FiThermometer,
    FiSun,
    FiDroplet,
    FiWind,
    FiBarChart2,
    FiMaximize2,
    FiMapPin
} from 'react-icons/fi';
import {
    consultarPerfilTermicoMunicipal,
    type PerfilTermicoMunicipal
} from './perfilTermicoMunicipal';



type AbaObservatorio =
    | 'agora'
    | 'estacoes'
    | 'historico'
    | 'comparar';

type Props = {
    municipio: string;
    uf: string;
    latitude: number;
    longitude: number;
    distritoNome?: string | null;
    latitudeArea?: number;
    longitudeArea?: number;
    codigoMunicipio: string;
    municipiosCeara: FeatureCollection | null;
    geometria: Geometry;
    onPerfilTermico: (
        perfil: PerfilTermicoMunicipal | null,
        erro?: string | null
    ) => void;
    estacoesMunicipais: EstacaoPublica[];
    carregandoEstacoes: boolean;
    erroEstacoes: string | null;
    instanteAtual: number;
    idEstacaoSelecionada: string | null;
    onSelecionarEstacao: (id: string | null) => void;
};

type DadosMeteorologicosAtuais = {
    temperatura: number;
    sensacao: number;
    umidade: number;
    vento: number;
    horario: string;
};

const ABAS: { id: AbaObservatorio; nome: string }[] = [
    { id: 'agora', nome: 'Agora' },
    { id: 'estacoes', nome: 'Estações' },
    { id: 'historico', nome: 'Histórico' },
    { id: 'comparar', nome: 'Comparar' }
];

const INDICADORES = [
    {
        titulo: 'Temperatura',
        unidade: '°C',
        campo: 'temperatura',
        icone: <FiThermometer />,
        tom: 'temperatura'
    },
    {
        titulo: 'Sensação térmica',
        unidade: '°C',
        campo: 'sensacao',
        icone: <FiSun />,
        tom: 'sensacao'
    },
    {
        titulo: 'Umidade relativa',
        unidade: '%',
        campo: 'umidade',
        icone: <FiDroplet />,
        tom: 'umidade'
    },
    {
        titulo: 'Velocidade do vento',
        unidade: 'km/h',
        campo: 'vento',
        icone: <FiWind />,
        tom: 'vento'
    }
] as const;

export default function ObservatorioMunicipal({
    municipio,
    uf,
    latitude,
    distritoNome,
    latitudeArea,
    longitudeArea,
    estacoesMunicipais,
    carregandoEstacoes,
    erroEstacoes,
    instanteAtual,
    idEstacaoSelecionada,
    codigoMunicipio,
    municipiosCeara,
    onSelecionarEstacao,
    longitude,
    geometria,
    onPerfilTermico
}: Props) {
    const latitudeConsulta = latitudeArea ?? latitude;
    const longitudeConsulta = longitudeArea ?? longitude;
    const [aba, setAba] =
        useState<AbaObservatorio>('agora');

    const [dadosAtuais, setDadosAtuais] =
        useState<DadosMeteorologicosAtuais | null>(null);

    const [carregando, setCarregando] = useState(true);
    const [erroMeteo, setErroMeteo] = useState<string | null>(null);

    useEffect(() => {
        const controlador = new AbortController();

        const consultar = async (primeiraConsulta = false) => {
            if (primeiraConsulta) {
                setCarregando(true);
                setDadosAtuais(null);
            }

            setErroMeteo(null);

            try {
                const parametros = new URLSearchParams({
                    latitude: latitudeConsulta.toFixed(5),
                    longitude: longitudeConsulta.toFixed(5),
                    current: [
                        'temperature_2m',
                        'apparent_temperature',
                        'relative_humidity_2m',
                        'wind_speed_10m'
                    ].join(','),
                    timezone: 'America/Fortaleza',
                    wind_speed_unit: 'kmh'
                });



                type LeituraApi = {
                    time: string;
                    temperature_2m: number;
                    apparent_temperature: number;
                    relative_humidity_2m: number;
                    wind_speed_10m: number;
                };

                const resultado = await consultarOpenMeteoComCache(
                    `https://api.open-meteo.com/v1/forecast?${parametros.toString()}`,
                    controlador.signal
                ) as {
                    current?: LeituraApi;
                };

                const atual = resultado.current;

                if (
                    !atual ||
                    typeof atual.time !== 'string' ||
                    !Number.isFinite(atual.temperature_2m) ||
                    !Number.isFinite(atual.apparent_temperature) ||
                    !Number.isFinite(atual.relative_humidity_2m) ||
                    !Number.isFinite(atual.wind_speed_10m)
                ) {
                    throw new Error('Dados meteorológicos inválidos');
                }

                if (!controlador.signal.aborted) {
                    setDadosAtuais({
                        temperatura: atual.temperature_2m,
                        sensacao: atual.apparent_temperature,
                        umidade: atual.relative_humidity_2m,
                        vento: atual.wind_speed_10m,
                        horario: atual.time
                    });
                }
            } catch (erro) {
                if (!controlador.signal.aborted) {
                    setErroMeteo(
                        erro instanceof Error && erro.message.includes('429')
                            ? 'Open-Meteo temporariamente indisponível por limite de consultas.'
                            : 'Não foi possível consultar a Open-Meteo.'
                    );
                }
            } finally {
                if (!controlador.signal.aborted) {
                    setCarregando(false);
                }
            }
        };

        void consultar(true);

        const intervalo = window.setInterval(() => {
            if (!document.hidden) {
                void consultar();
            }
        }, 15 * 60 * 1000);

        return () => {
            window.clearInterval(intervalo);
            controlador.abort();
        };
    }, [latitudeConsulta, longitudeConsulta]);


    // PERFIL TÉRMICO — AMOSTRAGEM MUNICIPAL
    const [perfilTermico, setPerfilTermico] =
        useState<PerfilTermicoMunicipal | null>(null);

    const [carregandoPerfil, setCarregandoPerfil] =
        useState(true);

    const [erroPerfil, setErroPerfil] =
        useState<string | null>(null);

    useEffect(() => {
        const controlador = new AbortController();

        setCarregandoPerfil(true);
        setErroPerfil(null);
        setPerfilTermico(null);

        void consultarPerfilTermicoMunicipal(
            geometria,
            controlador.signal
        )
            .then(resultado => {
                if (!controlador.signal.aborted) {
                    setPerfilTermico(resultado);
                }
            })
            .catch(erro => {
                if (!controlador.signal.aborted) {
                    console.error(
                        'Erro no perfil térmico municipal:',
                        erro
                    );

                    setErroPerfil(
                        erro instanceof Error
                            ? erro.message
                            : 'Não foi possível calcular o perfil térmico.'
                    );
                }
            })
            .finally(() => {
                if (!controlador.signal.aborted) {
                    setCarregandoPerfil(false);
                }
            });

        return () => controlador.abort();
    }, [geometria]);

    // Compartilha os dados já consultados com o mapa.
    useEffect(() => {
        onPerfilTermico(perfilTermico, erroPerfil);
    }, [perfilTermico, erroPerfil, onPerfilTermico]);

    const formatarTemperatura = (valor: number) =>
        `${valor.toFixed(1).replace('.', ',')} °C`;

    // Ao selecionar uma estação no mapa,
    // abre automaticamente a aba Estações.
    useEffect(() => {
        if (idEstacaoSelecionada) {
            setAba('estacoes');
        }
    }, [idEstacaoSelecionada]);

    const quantidadeEstacoesRecentes =
        estacoesMunicipais.filter(estacao => {
            const leitura = estacao.ultimaLeitura;

            return (
                leitura !== null &&
                instanteAtual >= leitura.recebidoEm &&
                instanteAtual - leitura.recebidoEm <=
                30 * 60 * 1000
            );
        }).length;

    return (
        <section className="obs-municipal">

            <header className="obs-cabecalho">
                <div className="obs-sobretitulo">
                    CUIDAÍ | OBSERVATÓRIO MUNICIPAL
                </div>

                <h3>{distritoNome ?? municipio}, {uf}</h3>

                <p>
                    Investigação meteorológica do território
                </p>

                <span className="obs-situacao">
                    {aba === 'agora'
                        ? carregando
                            ? 'Consultando Open-Meteo...'
                            : erroMeteo
                                ? dadosAtuais
                                    ? 'Open-Meteo • Última estimativa disponível'
                                    : 'Dados indisponíveis'
                                : 'Open-Meteo • Estimativa meteorológica'
                        : aba === 'estacoes'
                            ? 'CUIDAÍ • Medições das estações'
                            : aba === 'historico'
                                ? 'CUIDAÍ • Histórico de medições'
                                : 'Open-Meteo • Comparação territorial'}
                </span>
            </header>

            <nav
                className="obs-abas"
                aria-label="Análises meteorológicas"
            >
                {ABAS.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={
                            aba === item.id
                                ? 'obs-aba obs-aba--ativa'
                                : 'obs-aba'
                        }
                        aria-pressed={aba === item.id}
                        onClick={() => setAba(item.id)}
                    >
                        {item.nome}
                    </button>
                ))}
            </nav>

            <div className="obs-conteudo">

                {aba === 'agora' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Condições meteorológicas</h4>
                            <span>Open-Meteo</span>
                        </div>

                        <div className="obs-grade-indicadores">
                            {INDICADORES.map(indicador => (
                                <article
                                    className={`obs-indicador obs-indicador--${indicador.tom}`}
                                    key={indicador.titulo}
                                >
                                    <div className="obs-indicador-topo">
                                        <div className="obs-indicador-titulo">
                                            {indicador.titulo}
                                        </div>

                                        <span
                                            className="obs-indicador-icone"
                                            aria-hidden="true"
                                        >
                                            {indicador.icone}
                                        </span>
                                    </div>

                                    <div className="obs-indicador-valor">
                                        {dadosAtuais
                                            ? dadosAtuais[indicador.campo].toLocaleString(
                                                'pt-BR',
                                                {
                                                    minimumFractionDigits:
                                                        indicador.campo === 'umidade' ? 0 : 1,
                                                    maximumFractionDigits:
                                                        indicador.campo === 'umidade' ? 0 : 1
                                                }
                                            )
                                            : '—'}

                                        <small>{indicador.unidade}</small>
                                    </div>

                                    {(carregando || erroMeteo) && (
                                        <div className="obs-indicador-nota">
                                            {carregando
                                                ? 'Consultando...'
                                                : 'Consulta indisponível'}
                                        </div>
                                    )}
                                </article>
                            ))}
                        </div>


                        {/* FONTE E REFERÊNCIA DA CONSULTA */}
                        {/* FONTE E REFERÊNCIA DA CONSULTA */}
                        <div className="obs-referencia-compacta">

                            {carregando && (
                                <span>Atualizando dados meteorológicos...</span>
                            )}

                            {!carregando && erroMeteo && (
                                <span role="alert">{erroMeteo}</span>
                            )}

                            {!carregando && dadosAtuais && (
                                <>
                                    <div className="obs-referencia-linha">
                                        <strong>Open-Meteo</strong>
                                        <span aria-hidden="true">•</span>
                                        <span>
                                            Referência:{' '}
                                            {dadosAtuais.horario.replace('T', ' às ')}
                                            {' • Fortaleza'}
                                        </span>
                                    </div>

                                    <details className="obs-referencia-detalhes">
                                        <summary>
                                            Detalhes da estimativa
                                        </summary>

                                        <div className="obs-referencia-conteudo">
                                            <p>
                                                <strong>Coordenadas:</strong>{' '}
                                                {latitudeConsulta.toFixed(4)},{' '}
                                                {longitudeConsulta.toFixed(4)}
                                            </p>

                                            <p>
                                                <p>
                                                    Estimativa meteorológica para um ponto de referência
                                                    da área selecionada. Não representa medição de
                                                    uma estação local nem média de todo o território.
                                                </p>
                                            </p>
                                        </div>
                                    </details>
                                </>
                            )}

                        </div>

                        <details className="obs-sintese-gestao">
                            <summary>
                                <span>Síntese para gestão</span>
                                <small>Cobertura e orientação</small>
                            </summary>

                            <div className="obs-sintese-corpo">

                                <div className="obs-sintese-item">
                                    <strong>Observações locais</strong>

                                    <p>
                                        {carregandoEstacoes
                                            ? 'Verificando estações...'
                                            : erroEstacoes
                                                ? 'Disponibilidade não confirmada.'
                                                : estacoesMunicipais.length === 0
                                                    ? 'Nenhuma estação CUIDAÍ publicada na área selecionada.'
                                                    : `${quantidadeEstacoesRecentes} de ${estacoesMunicipais.length} estações com leitura nos últimos 30 minutos.`}
                                    </p>
                                </div>

                                <div className="obs-sintese-item">
                                    <strong>Variação térmica territorial</strong>

                                    <p>
                                        {carregandoPerfil
                                            ? 'Calculando perfil térmico...'
                                            : erroPerfil || !perfilTermico
                                                ? 'Perfil térmico indisponível.'
                                                : `Diferença estimada de ${formatarTemperatura(
                                                    perfilTermico.maxima -
                                                    perfilTermico.minima
                                                )} entre os pontos amostrados.`}
                                    </p>
                                </div>

                                <div className="obs-sintese-item">
                                    <strong>Orientação de acompanhamento</strong>

                                    <p>
                                        {!carregandoEstacoes &&
                                            !erroEstacoes &&
                                            estacoesMunicipais.length > 0 &&
                                            quantidadeEstacoesRecentes === 0
                                            ? 'Sem leituras recentes. Verifique a disponibilidade das estações antes de utilizar registros antigos como condições atuais.'
                                            : 'Consulte a aba Estações para verificar leituras e horários registrados pelos sensores.'}
                                    </p>
                                </div>

                                <p className="obs-sintese-nota">
                                    Dados para acompanhamento territorial.
                                    As estimativas da Open-Meteo não substituem
                                    medições locais nem constituem alertas
                                    oficiais de risco.
                                </p>

                            </div>
                        </details>

                        <article className="obs-bloco">
                            <div className="obs-bloco-cabecalho">
                                <h4>Perfil térmico</h4>
                                <span>Análise espacial</span>
                            </div>


                            {carregandoPerfil && (
                                <p>Calculando o perfil térmico da área selecionada...</p>
                            )}

                            {!carregandoPerfil && erroPerfil && (
                                <p role="alert">{erroPerfil}</p>
                            )}

                            {!carregandoPerfil && perfilTermico && (
                                <div className="obs-perfil-termico-bonito">
                                    <div className="obs-perfil-termico-grid-principal">

                                        <article className="obs-perfil-card obs-perfil-card--min">
                                            <div className="obs-perfil-card-topo">
                                                <span className="obs-perfil-card-titulo">
                                                    Mínima amostral
                                                </span>
                                                <span className="obs-perfil-card-icone">
                                                    <FiThermometer />
                                                </span>
                                            </div>

                                            <strong className="obs-perfil-card-valor">
                                                {formatarTemperatura(perfilTermico.minima)}
                                            </strong>

                                            <span className="obs-perfil-card-legenda">
                                                ponto mais ameno
                                            </span>
                                        </article>

                                        <article className="obs-perfil-card obs-perfil-card--media">
                                            <div className="obs-perfil-card-topo">
                                                <span className="obs-perfil-card-titulo">
                                                    Média amostral
                                                </span>
                                                <span className="obs-perfil-card-icone">
                                                    <FiBarChart2 />
                                                </span>
                                            </div>

                                            <strong className="obs-perfil-card-valor">
                                                {formatarTemperatura(perfilTermico.media)}
                                            </strong>

                                            <span className="obs-perfil-card-legenda">
                                                comportamento médio
                                            </span>
                                        </article>

                                        <article className="obs-perfil-card obs-perfil-card--max">
                                            <div className="obs-perfil-card-topo">
                                                <span className="obs-perfil-card-titulo">
                                                    Máxima amostral
                                                </span>
                                                <span className="obs-perfil-card-icone">
                                                    <FiSun />
                                                </span>
                                            </div>

                                            <strong className="obs-perfil-card-valor">
                                                {formatarTemperatura(perfilTermico.maxima)}
                                            </strong>

                                            <span className="obs-perfil-card-legenda">
                                                ponto mais quente
                                            </span>
                                        </article>

                                    </div>

                                    <div className="obs-perfil-termico-grid-secundario">

                                        <article className="obs-perfil-card obs-perfil-card--amplitude">
                                            <div className="obs-perfil-card-topo">
                                                <span className="obs-perfil-card-titulo">
                                                    Amplitude espacial
                                                </span>
                                                <span className="obs-perfil-card-icone">
                                                    <FiMaximize2 />
                                                </span>
                                            </div>

                                            <strong className="obs-perfil-card-valor">
                                                {formatarTemperatura(
                                                    perfilTermico.maxima - perfilTermico.minima
                                                )}
                                            </strong>

                                            <span className="obs-perfil-card-legenda">
                                                diferença entre mínima e máxima
                                            </span>
                                        </article>

                                        <article className="obs-perfil-card obs-perfil-card--pontos">
                                            <div className="obs-perfil-card-topo">
                                                <span className="obs-perfil-card-titulo">
                                                    Pontos representativos
                                                </span>
                                                <span className="obs-perfil-card-icone">
                                                    <FiMapPin />
                                                </span>
                                            </div>

                                            <strong className="obs-perfil-card-valor">
                                                {perfilTermico.amostras}
                                            </strong>

                                            <span className="obs-perfil-card-legenda">
                                                pontos da amostragem espacial
                                            </span>
                                        </article>

                                    </div>

                                    <p className="obs-perfil-termico-nota">
                                        Perfil calculado com estimativas da Open-Meteo em
                                        pontos amostrados. Não representa medições locais
                                        nem a temperatura de todos os pontos do território.
                                    </p>

                                    <details className="obs-perfil-termico-metodo">
                                        <summary>Ver metodologia da amostragem</summary>

                                        <div className="obs-perfil-termico-metodo-conteudo">
                                            <p>
                                                <strong>Coordenadas consultadas: </strong>
                                                {perfilTermico.coordenadasConsultadas}
                                            </p>

                                            <p>
                                                {perfilTermico.celulasIdentificadas
                                                    ? 'Pontos repetidos da mesma célula meteorológica foram agrupados.'
                                                    : 'Nem todas as células meteorológicas puderam ser identificadas.'}
                                            </p>

                                            <p>
                                                Amostragem espacial exploratória com refinamento territorial.
                                            </p>

                                            <p>
                                                <strong>Referência: </strong>
                                                {perfilTermico.horario.replace('T', ' às ')}
                                                {' • Horário de Fortaleza'}
                                            </p>
                                        </div>
                                    </details>
                                </div>
                            )}
                        </article>

                    </>
                )}


                {aba === 'estacoes' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Estações meteorológicas</h4>
                            <span>
                                {carregandoEstacoes
                                    ? 'Carregando...'
                                    : erroEstacoes
                                        ? 'Dados indisponíveis'
                                        : `${estacoesMunicipais.length} ${estacoesMunicipais.length === 1
                                            ? 'estação'
                                            : 'estações'
                                        }`}
                            </span>
                        </div>

                        {carregandoEstacoes ? (
                            <article className="obs-bloco">
                                <p>Consultando estações meteorológicas...</p>
                            </article>
                        ) : erroEstacoes ? (
                            <article className="obs-bloco">
                                <p role="alert">{erroEstacoes}</p>
                            </article>
                        ) : estacoesMunicipais.length === 0 ? (
                            <article className="obs-bloco">
                                <div className="obs-estado-vazio">
                                    <h4>Nenhuma estação localizada</h4>
                                    Ainda não há estações CUIDAÍ
                                    publicadas com localização dentro
                                    dos limites de {distritoNome ?? municipio}.
                                    <p>
                                        As estimativas meteorológicas
                                        continuam disponíveis na aba Agora.
                                    </p>
                                </div>
                            </article>
                        ) : (
                            <>


                                {estacoesMunicipais.map(estacao => {
                                    const leitura = estacao.ultimaLeitura;

                                    const recente =
                                        leitura !== null &&
                                        instanteAtual >= leitura.recebidoEm &&
                                        instanteAtual - leitura.recebidoEm <=
                                        30 * 60 * 1000;

                                    const selecionada =
                                        idEstacaoSelecionada === estacao.id;

                                    return (
                                        <button
                                            key={estacao.id}
                                            className={`obs-estacao-card-municipal ${selecionada
                                                ? 'obs-estacao-card-municipal--selecionada'
                                                : ''
                                                }`}
                                            aria-pressed={selecionada}
                                            type="button"
                                            onClick={() =>
                                                onSelecionarEstacao(
                                                    selecionada ? null : estacao.id
                                                )
                                            }
                                            style={{
                                                width: '100%',
                                                display: 'block',
                                                textAlign: 'left',
                                                padding: '18px',
                                                marginBottom: '12px',
                                                borderRadius: '16px',
                                                border: selecionada
                                                    ? '2px solid #168FC4'
                                                    : '1px solid #DCE8F3',
                                                background: selecionada
                                                    ? '#F0F8FF'
                                                    : '#FFFFFF',
                                                color: '#192942',
                                                fontFamily: 'inherit',
                                                cursor: 'pointer'
                                            }}
                                        >
                                            <div
                                                className={`obs-estacao-status ${recente ? 'obs-estacao-status--recente' : ''
                                                    }`}
                                                style={{
                                                    display: 'flex',
                                                    justifyContent: 'space-between',
                                                    alignItems: 'center',
                                                    gap: '10px',
                                                    flexWrap: 'wrap'
                                                }}
                                            >
                                                <strong>
                                                    {estacao.nome}
                                                </strong>

                                                <span
                                                    style={{
                                                        fontSize: '11px',
                                                        fontWeight: 700,
                                                        color: recente
                                                            ? '#287856'
                                                            : '#64748B'
                                                    }}
                                                >
                                                    {recente
                                                        ? 'Leitura recente'
                                                        : leitura
                                                            ? 'Sem dados recentes'
                                                            : 'Sem medição'}
                                                </span>
                                            </div>

                                            {estacao.experimental && (
                                                <p
                                                    style={{
                                                        fontSize: '11px',
                                                        color: '#94701E'
                                                    }}
                                                >
                                                    Estação experimental
                                                </p>
                                            )}

                                            <div className="obs-estacao-metricas">

                                                <div className="obs-estacao-metrica obs-estacao-metrica--temperatura">
                                                    <div className="obs-estacao-metrica-topo">
                                                        <span>Temperatura</span>

                                                        <span className="obs-estacao-metrica-icone">
                                                            <FiThermometer />
                                                        </span>
                                                    </div>

                                                    <strong>
                                                        {leitura
                                                            ? `${leitura.temperatura.toFixed(1).replace('.', ',')} °C`
                                                            : '—'}
                                                    </strong>
                                                </div>

                                                <div className="obs-estacao-metrica obs-estacao-metrica--umidade">
                                                    <div className="obs-estacao-metrica-topo">
                                                        <span>Umidade</span>

                                                        <span className="obs-estacao-metrica-icone">
                                                            <FiDroplet />
                                                        </span>
                                                    </div>

                                                    <strong>
                                                        {leitura
                                                            ? `${leitura.umidade.toFixed(0)}%`
                                                            : '—'}
                                                    </strong>
                                                </div>

                                            </div>

                                            <p
                                                style={{
                                                    fontSize: '11px',
                                                    color: '#8190A2',
                                                    marginTop: '14px'
                                                }}
                                            >
                                                {leitura
                                                    ? `Última leitura: ${new Date(
                                                        leitura.recebidoEm
                                                    ).toLocaleString('pt-BR', {
                                                        timeZone: 'America/Fortaleza'
                                                    })}`
                                                    : 'Nenhuma leitura válida disponível.'}
                                            </p>

                                            <div
                                                className="obs-estacao-acao"
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: 700,
                                                    color: '#087CDB'
                                                }}
                                            >
                                                <FiMapPin aria-hidden="true" />

                                                {selecionada
                                                    ? 'Remover destaque'
                                                    : 'Selecionar no mapa'}
                                            </div>
                                        </button>
                                    );
                                })}
                            </>
                        )}


                    </>
                )}


                {aba === 'historico' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Evolução meteorológica</h4>
                            <span>Dados históricos • Firebase</span>
                        </div>

                        <HistoricoEstacoes
                            estacoes={estacoesMunicipais}
                            idEstacaoSelecionada={idEstacaoSelecionada}
                        />
                    </>
                )}

                {aba === 'comparar' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Comparação territorial</h4>
                        </div>

                        <p
                            className="comparacao-nota"
                            style={{ margin: '0 2px 8px' }}
                        >
                            Estimativas pontuais Open-Meteo, não médias territoriais.
                        </p>

                        <ComparacaoMunicipal
                            municipioAtual={municipio}
                            codigoAtual={codigoMunicipio}
                            latitudeAtual={latitude}
                            longitudeAtual={longitude}
                            municipios={municipiosCeara}
                        />
                    </>
                )}
            </div>

        </section>
    );
}
