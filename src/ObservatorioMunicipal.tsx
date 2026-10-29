
import { useEffect, useState } from 'react';
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
    codigoMunicipio: string;
    municipiosCeara: FeatureCollection | null;
    geometria: Geometry;
    onPerfilTermico: (
        perfil: PerfilTermicoMunicipal | null
    ) => void;
    estacoesMunicipais: EstacaoPublica[];
    carregandoEstacoes: boolean;
    erroEstacoes: string | null;
    instanteAtual: number;
    idEstacaoSelecionada: string | null;
    onSelecionarEstacao: (id: string) => void;
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
    { titulo: 'Temperatura', unidade: '°C', campo: 'temperatura' },
    { titulo: 'Sensação térmica', unidade: '°C', campo: 'sensacao' },
    { titulo: 'Umidade relativa', unidade: '%', campo: 'umidade' },
    { titulo: 'Velocidade do vento', unidade: 'km/h', campo: 'vento' }
] as const;

export default function ObservatorioMunicipal({
    municipio,
    uf,
    latitude,
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
    const [aba, setAba] =
        useState<AbaObservatorio>('agora');

    const [dadosAtuais, setDadosAtuais] =
        useState<DadosMeteorologicosAtuais | null>(null);

    const [carregando, setCarregando] = useState(true);
    const [erroMeteo, setErroMeteo] = useState<string | null>(null);

    useEffect(() => {
        const controlador = new AbortController();

        const consultar = async () => {
            setCarregando(true);
            setErroMeteo(null);
            setDadosAtuais(null);

            try {
                const parametros = new URLSearchParams({
                    latitude: latitude.toFixed(5),
                    longitude: longitude.toFixed(5),
                    current: [
                        'temperature_2m',
                        'apparent_temperature',
                        'relative_humidity_2m',
                        'wind_speed_10m'
                    ].join(','),
                    timezone: 'America/Fortaleza',
                    wind_speed_unit: 'kmh'
                });

                const resposta = await fetch(
                    `https://api.open-meteo.com/v1/forecast?${parametros}`,
                    { signal: controlador.signal }
                );

                if (!resposta.ok) {
                    throw new Error('Falha na consulta meteorológica');
                }

                type LeituraApi = {
                    time: string;
                    temperature_2m: number;
                    apparent_temperature: number;
                    relative_humidity_2m: number;
                    wind_speed_10m: number;
                };

                const resultado = await resposta.json() as {
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
            } catch {
                if (!controlador.signal.aborted) {
                    setErroMeteo('Não foi possível consultar a Open-Meteo.');
                }
            } finally {
                if (!controlador.signal.aborted) {
                    setCarregando(false);
                }
            }
        };

        void consultar();

        return () => controlador.abort();
    }, [latitude, longitude]);


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
                        'Não foi possível calcular o perfil térmico.'
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
        onPerfilTermico(perfilTermico);
    }, [perfilTermico, onPerfilTermico]);

    const formatarTemperatura = (valor: number) =>
        `${valor.toFixed(1).replace('.', ',')} °C`;

    // Ao selecionar uma estação no mapa,
    // abre automaticamente a aba Estações.
    useEffect(() => {
        if (idEstacaoSelecionada) {
            setAba('estacoes');
        }
    }, [idEstacaoSelecionada]);


    return (
        <section className="obs-municipal">

            <header className="obs-cabecalho">
                <div className="obs-sobretitulo">
                    CUIDAÍ | OBSERVATÓRIO MUNICIPAL
                </div>

                <h3>{municipio}, {uf}</h3>

                <p>
                    Investigação meteorológica do território
                </p>

                <span className="obs-situacao">
                    {carregando
                        ? 'Consultando Open-Meteo...'
                        : erroMeteo
                            ? 'Dados indisponíveis'
                            : 'Open-Meteo • Estimativa atual'}
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
                                    className="obs-indicador"
                                    key={indicador.titulo}
                                >
                                    <div className="obs-indicador-titulo">
                                        {indicador.titulo}
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

                                    <div className="obs-indicador-nota">
                                        {carregando
                                            ? 'Consultando...'
                                            : erroMeteo
                                                ? 'Sem dados disponíveis'
                                                : 'Estimativa Open-Meteo'}
                                    </div>
                                </article>
                            ))}
                        </div>


                        {/* FONTE E REFERÊNCIA DA CONSULTA */}
                        <div
                            style={{
                                marginBottom: '16px',
                                padding: '12px 14px',
                                background: '#F4F9FD',
                                border: '1px solid #E1EBF4',
                                borderRadius: '10px',
                                color: '#61788E',
                                fontSize: '11px',
                                lineHeight: 1.7
                            }}
                        >
                            {carregando && (
                                <span>Atualizando informações meteorológicas...</span>
                            )}

                            {!carregando && erroMeteo && (
                                <span role="alert">{erroMeteo}</span>
                            )}

                            {!carregando && dadosAtuais && (
                                <>
                                    <div>
                                        <strong>Fonte:</strong> Open-Meteo
                                        {' • '}
                                        <strong>Referência:</strong>{' '}
                                        {dadosAtuais.horario.replace('T', ' às ')}
                                        {' • Horário de Fortaleza'}
                                    </div>

                                    <div>
                                        Ponto de referência:
                                        {' '}{latitude.toFixed(4)},
                                        {' '}{longitude.toFixed(4)}
                                    </div>

                                    <div>
                                        Estimativas meteorológicas para um ponto
                                        de referência do município.
                                    </div>
                                </>
                            )}
                        </div>



                        <article className="obs-bloco">
                            <div className="obs-bloco-cabecalho">
                                <h4>Perfil térmico</h4>
                                <span>Análise espacial</span>
                            </div>

                            <div className="obs-estatisticas">
                                <div>
                                    <small>Mínima amostral</small>
                                    <strong>
                                        {perfilTermico
                                            ? formatarTemperatura(perfilTermico.minima)
                                            : '—'}
                                    </strong>
                                </div>

                                <div>
                                    <small>Média amostral</small>
                                    <strong>
                                        {perfilTermico
                                            ? formatarTemperatura(perfilTermico.media)
                                            : '—'}
                                    </strong>
                                </div>

                                <div>
                                    <small>Máxima amostral</small>
                                    <strong>
                                        {perfilTermico
                                            ? formatarTemperatura(perfilTermico.maxima)
                                            : '—'}
                                    </strong>
                                </div>
                            </div>

                            {carregandoPerfil && (
                                <p>Calculando a distribuição térmica do município...</p>
                            )}

                            {!carregandoPerfil && erroPerfil && (
                                <p role="alert">{erroPerfil}</p>
                            )}

                            {!carregandoPerfil && perfilTermico && (
                                <>
                                    <div
                                        style={{
                                            marginTop: '14px',
                                            padding: '12px 14px',
                                            background: '#F4F9FD',
                                            borderRadius: '10px',
                                            fontSize: '12px',
                                            color: '#48657D'
                                        }}
                                    >
                                        <strong>Amplitude espacial estimada: </strong>
                                        {formatarTemperatura(
                                            perfilTermico.maxima - perfilTermico.minima
                                        )}
                                    </div>

                                    <p>
                                        <strong>
                                            {perfilTermico.amostras} pontos representativos
                                        </strong>
                                        {' dentro dos limites municipais.'}
                                    </p>

                                    <p>
                                        <strong>
                                            {perfilTermico.coordenadasConsultadas}
                                            {' coordenadas consultadas'}
                                        </strong>
                                        {' • '}
                                        {perfilTermico.celulasIdentificadas
                                            ? 'Pontos repetidos da mesma célula meteorológica foram agrupados.'
                                            : 'Nem todas as células meteorológicas puderam ser identificadas.'}
                                    </p>

                                    <p>
                                        <p>
                                            Amostragem espacial exploratória:
                                            espaçamento-alvo aproximado de 3 km,
                                            com refinamento para territórios pequenos
                                            e limite de 90 coordenadas por consulta.
                                        </p>
                                    </p>

                                    <p>
                                        Referência: {' '}
                                        {perfilTermico.horario.replace('T', ' às ')}
                                        {' • Horário de Fortaleza.'}
                                    </p>

                                    <p>
                                        Valores estimados pela Open-Meteo.
                                        A média é calculada sobre os pontos
                                        amostrados e não representa uma
                                        medição oficial de todo o território.
                                        Os pontos podem compartilhar células
                                        do mesmo modelo meteorológico.
                                    </p>
                                </>
                            )}
                        </article>

                    </>
                )}


                {aba === 'estacoes' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Rede de observação</h4>
                            <span>Estações CUIDAÍ • Firebase</span>
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
                                    <p>
                                        Ainda não há estações CUIDAÍ
                                        publicadas com localização dentro
                                        dos limites de {municipio}.
                                    </p>
                                    <p>
                                        As estimativas meteorológicas
                                        continuam disponíveis na aba Agora.
                                    </p>
                                </div>
                            </article>
                        ) : (
                            <>
                                <article className="obs-bloco">
                                    <strong>
                                        {estacoesMunicipais.length}
                                        {' '}
                                        {estacoesMunicipais.length === 1
                                            ? 'estação localizada'
                                            : 'estações localizadas'}
                                    </strong>
                                    <p>
                                        Selecione uma estação para
                                        destacá-la no mapa municipal.
                                    </p>
                                </article>

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
                                            type="button"
                                            onClick={() =>
                                                onSelecionarEstacao(estacao.id)
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
                                                            ? 'Leitura antiga'
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

                                            <div
                                                style={{
                                                    display: 'grid',
                                                    gridTemplateColumns: '1fr 1fr',
                                                    gap: '12px',
                                                    marginTop: '16px'
                                                }}
                                            >
                                                <div>
                                                    <div
                                                        style={{
                                                            fontSize: '11px',
                                                            color: '#8190A2'
                                                        }}
                                                    >
                                                        Temperatura
                                                    </div>

                                                    <strong
                                                        style={{
                                                            fontSize: '24px'
                                                        }}
                                                    >
                                                        {leitura
                                                            ? `${leitura.temperatura.toFixed(1).replace('.', ',')} °C`
                                                            : '—'}
                                                    </strong>
                                                </div>

                                                <div>
                                                    <div
                                                        style={{
                                                            fontSize: '11px',
                                                            color: '#8190A2'
                                                        }}
                                                    >
                                                        Umidade
                                                    </div>

                                                    <strong
                                                        style={{
                                                            fontSize: '24px'
                                                        }}
                                                    >
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
                                                    ).toLocaleString('pt-BR')}`
                                                    : 'Nenhuma leitura válida disponível.'}
                                            </p>

                                            <div
                                                style={{
                                                    fontSize: '12px',
                                                    fontWeight: 700,
                                                    color: '#087CDB'
                                                }}
                                            >
                                                Selecionar no mapa
                                            </div>
                                        </button>
                                    );
                                })}
                            </>
                        )}

                        <p
                            style={{
                                fontSize: '11px',
                                lineHeight: 1.6,
                                color: '#8190A2'
                            }}
                        >
                            As medições das estações são diferentes
                            das estimativas da Open-Meteo.
                            A ausência de uma leitura recente não
                            significa necessariamente que a estação
                            esteja desligada.
                        </p>
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
                            <span>Dois municípios • Open-Meteo</span>
                        </div>

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

            <footer className="obs-rodape">
                <strong>Fontes e metodologia</strong>
                <p>
                    Estimativas meteorológicas da Open-Meteo
                    e observações das estações CUIDAÍ serão
                    identificadas separadamente, com seus
                    respectivos horários de referência.
                </p>
            </footer>

        </section>
    );
}
