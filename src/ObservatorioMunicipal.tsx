
import { useEffect, useState } from 'react';

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
    longitude
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
                                <span>Análise territorial</span>
                            </div>

                            <div className="obs-estatisticas">
                                <div>
                                    <small>Mínima</small>
                                    <strong>—</strong>
                                </div>

                                <div>
                                    <small>Média</small>
                                    <strong>—</strong>
                                </div>

                                <div>
                                    <small>Máxima</small>
                                    <strong>—</strong>
                                </div>
                            </div>

                            <p>
                                Aqui serão apresentadas estatísticas
                                calculadas a partir dos pontos
                                meteorológicos amostrados no município.
                            </p>
                        </article>
                    </>
                )}

                {aba === 'estacoes' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Rede de observação</h4>
                            <span>Firebase</span>
                        </div>

                        <div className="obs-bloco">
                            <div className="obs-estado-vazio">
                                <div className="obs-icone-vazio">
                                    <span />
                                    <span />
                                    <span />
                                </div>

                                <h4>Estações no território</h4>

                                <p>
                                    As estações CUIDAÍ localizadas em
                                    {` ${municipio}`} serão exibidas aqui,
                                    com disponibilidade, temperatura,
                                    umidade e horário da última leitura.
                                </p>
                            </div>
                        </div>
                    </>
                )}

                {aba === 'historico' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Evolução meteorológica</h4>
                            <span>Séries temporais</span>
                        </div>

                        <article className="obs-bloco">
                            <div className="obs-grafico-vazio">
                                <div className="obs-grafico-grade">
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                </div>

                                <div className="obs-grafico-mensagem">
                                    Selecione uma estação com histórico
                                    disponível para visualizar as medições.
                                </div>
                            </div>

                            <p>
                                Os gráficos utilizarão leituras reais
                                armazenadas no Firebase, respeitando
                                os períodos disponíveis.
                            </p>
                        </article>
                    </>
                )}

                {aba === 'comparar' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Comparação territorial</h4>
                            <span>Dois municípios</span>
                        </div>

                        <div className="obs-comparacao">
                            <div className="obs-comparacao-local">
                                <span className="obs-ponto-azul" />
                                <small>Município A</small>
                                <strong>{municipio}</strong>
                            </div>

                            <div className="obs-comparacao-local">
                                <span className="obs-ponto-laranja" />
                                <small>Município B</small>
                                <strong>A selecionar</strong>
                            </div>
                        </div>

                        <article className="obs-bloco">
                            <h4>Compare dois territórios</h4>

                            <p>
                                Nesta área aparecerão as diferenças
                                de temperatura, umidade e vento entre
                                dois municípios, utilizando dados
                                referentes a horários compatíveis.
                            </p>

                            <p>
                                A seleção do segundo município será
                                conectada ao Atlas na próxima etapa.
                            </p>
                        </article>
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
