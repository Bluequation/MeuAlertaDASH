
import { useEffect, useMemo, useState } from 'react';
import type { FeatureCollection } from 'geojson';
import L from 'leaflet';

type Leitura = {
    temperatura: number;
    sensacao: number;
    umidade: number;
    vento: number;
    horario: string;
};

type Resultado = {
    a: Leitura;
    b: Leitura;
};

type Props = {
    municipioAtual: string;
    codigoAtual: string;
    latitudeAtual: number;
    longitudeAtual: number;
    municipios: FeatureCollection | null;
};

const INDICADORES = [
    { campo: 'temperatura', titulo: 'Temperatura', unidade: '°C' },
    { campo: 'sensacao', titulo: 'Sensação térmica', unidade: '°C' },
    { campo: 'umidade', titulo: 'Umidade relativa', unidade: '%' },
    { campo: 'vento', titulo: 'Velocidade do vento', unidade: 'km/h' }
] as const;

const formatar = (valor: number) =>
    valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });


function descreverComparacao(
    indicador: string,
    valorA: number,
    valorB: number,
    municipioA: string,
    municipioB: string,
    unidade: string
): string {
    const diferenca = valorB - valorA;

    if (Math.abs(diferenca) < 0.05) {
        return `A ${indicador.toLowerCase()} estimada é equivalente nos dois municípios, considerando a precisão apresentada.`;
    }

    const municipioMaior =
        diferenca > 0 ? municipioB : municipioA;

    const municipioMenor =
        diferenca > 0 ? municipioA : municipioB;

    return `Em ${municipioMaior}, a ${indicador.toLowerCase()} estimada é ${formatar(Math.abs(diferenca))} ${unidade} superior à de ${municipioMenor}.`;
}


function interpretarLeitura(item: unknown): Leitura | null {
    if (!item || typeof item !== 'object') return null;

    const atual = (
        item as { current?: Record<string, unknown> }
    ).current;

    if (!atual) return null;

    const {
        time,
        temperature_2m,
        apparent_temperature,
        relative_humidity_2m,
        wind_speed_10m
    } = atual;

    if (
        typeof time !== 'string' ||
        typeof temperature_2m !== 'number' ||
        !Number.isFinite(temperature_2m) ||
        typeof apparent_temperature !== 'number' ||
        !Number.isFinite(apparent_temperature) ||
        typeof relative_humidity_2m !== 'number' ||
        !Number.isFinite(relative_humidity_2m) ||
        typeof wind_speed_10m !== 'number' ||
        !Number.isFinite(wind_speed_10m)
    ) {
        return null;
    }

    return {
        temperatura: temperature_2m,
        sensacao: apparent_temperature,
        umidade: relative_humidity_2m,
        vento: wind_speed_10m,
        horario: time
    };
}

export default function ComparacaoMunicipal({
    municipioAtual,
    codigoAtual,
    latitudeAtual,
    longitudeAtual,
    municipios
}: Props) {
    const [codigoB, setCodigoB] = useState('');
    const [resultado, setResultado] =
        useState<Resultado | null>(null);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    const listaMunicipios = useMemo(() => {
        return (municipios?.features ?? [])
            .map(feature => ({
                codigo: String(feature.properties?.id ?? ''),
                nome: String(feature.properties?.name ?? '')
            }))
            .filter(item =>
                item.codigo !== codigoAtual &&
                item.codigo.length > 0 &&
                item.nome.length > 0
            )
            .sort((a, b) =>
                a.nome.localeCompare(b.nome, 'pt-BR')
            );
    }, [municipios, codigoAtual]);

    const municipioB = listaMunicipios.find(
        item => item.codigo === codigoB
    );

    const geometriaB = useMemo(() => {
        return municipios?.features.find(
            feature =>
                String(feature.properties?.id) === codigoB
        ) ?? null;
    }, [municipios, codigoB]);

    const pontoB = useMemo(() => {
        if (!geometriaB) return null;

        const limites = L.geoJSON(geometriaB).getBounds();

        if (!limites.isValid()) return null;

        const centro = limites.getCenter();

        return {
            latitude: centro.lat,
            longitude: centro.lng
        };
    }, [geometriaB]);

    useEffect(() => {
        const controlador = new AbortController();

        setResultado(null);
        setErro(null);

        if (!codigoB) {
            setCarregando(false);
            return () => controlador.abort();
        }

        if (!pontoB) {
            setCarregando(false);
            setErro('Município sem referência geográfica válida.');
            return () => controlador.abort();
        }

        setCarregando(true);

        const consultar = async () => {
            try {
                const parametros = new URLSearchParams({
                    latitude: [
                        latitudeAtual,
                        pontoB.latitude
                    ].map(valor => valor.toFixed(5)).join(','),

                    longitude: [
                        longitudeAtual,
                        pontoB.longitude
                    ].map(valor => valor.toFixed(5)).join(','),

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
                    throw new Error(
                        'Não foi possível consultar a Open-Meteo.'
                    );
                }

                const dados: unknown = await resposta.json();

                if (!Array.isArray(dados) || dados.length !== 2) {
                    throw new Error(
                        'Resposta inesperada da consulta meteorológica.'
                    );
                }

                const a = interpretarLeitura(dados[0]);
                const b = interpretarLeitura(dados[1]);

                if (!a || !b) {
                    throw new Error(
                        'As estimativas retornadas são inválidas.'
                    );
                }

                if (a.horario !== b.horario) {
                    throw new Error(
                        'Os horários das estimativas são incompatíveis.'
                    );
                }

                if (!controlador.signal.aborted) {
                    setResultado({ a, b });
                }
            } catch (falha) {
                if (!controlador.signal.aborted) {
                    setErro(
                        falha instanceof Error
                            ? falha.message
                            : 'Erro ao comparar municípios.'
                    );
                }
            } finally {
                if (!controlador.signal.aborted) {
                    setCarregando(false);
                }
            }
        };

        void consultar();

        return () => controlador.abort();
    }, [
        codigoB,
        pontoB,
        latitudeAtual,
        longitudeAtual
    ]);

    return (
        <div>
            <article className="obs-bloco">
                <h4>Escolha o segundo município</h4>

                <select
                    aria-label="Município para comparação"
                    value={codigoB}
                    onChange={evento =>
                        setCodigoB(evento.target.value)
                    }
                    style={{
                        width: '100%',
                        marginTop: 12,
                        padding: 13,
                        border: '1px solid #DCE8F3',
                        borderRadius: 11,
                        background: '#F5F9FD',
                        color: '#192942',
                        font: 'inherit'
                    }}
                >
                    <option value="">
                        Selecione um município do Ceará
                    </option>

                    {listaMunicipios.map(item => (
                        <option
                            key={item.codigo}
                            value={item.codigo}
                        >
                            {item.nome}
                        </option>
                    ))}
                </select>
            </article>

            <div style={{
                display: 'grid',
                gridTemplateColumns:
                    'repeat(auto-fit, minmax(190px, 1fr))',
                gap: 12,
                marginTop: 14
            }}>
                {[
                    {
                        titulo: 'Município A',
                        nome: municipioAtual,
                        cor: '#168FC4'
                    },
                    {
                        titulo: 'Município B',
                        nome: municipioB?.nome ?? 'A selecionar',
                        cor: '#E98645'
                    }
                ].map(item => (
                    <div
                        key={item.titulo}
                        style={{
                            padding: 17,
                            border: '1px solid #E0EAF3',
                            borderRadius: 15,
                            background: '#F8FAFD'
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            marginBottom: 9
                        }}>
                            <span style={{
                                width: 9,
                                height: 9,
                                borderRadius: '50%',
                                background: item.cor
                            }} />

                            <small style={{
                                color: '#8190A2',
                                fontWeight: 700
                            }}>
                                {item.titulo}
                            </small>
                        </div>

                        <strong style={{
                            color: '#192942',
                            fontSize: 17
                        }}>
                            {item.nome}
                        </strong>
                    </div>
                ))}
            </div>

            {carregando && (
                <article
                    className="obs-bloco"
                    style={{ marginTop: 14 }}
                >
                    <p>Comparando estimativas meteorológicas...</p>
                </article>
            )}

            {erro && (
                <article
                    className="obs-bloco"
                    style={{ marginTop: 14 }}
                >
                    <p role="alert">{erro}</p>
                </article>
            )}

            {resultado && municipioB && (
                <>
                    <p style={{
                        color: '#8190A2',
                        fontSize: 12,
                        margin: '18px 2px'
                    }}>
                        Open-Meteo • Referência:{' '}
                        {resultado.a.horario.replace('T', ' às ')}
                        {' • Horário de Fortaleza'}
                    </p>


                    <details className="comparacao-analise">
                        <summary>Ver análise dos resultados</summary>

                        <article
                            className="obs-bloco"
                            style={{
                                marginBottom: 16,
                                background: '#F5F9FD',
                                border: '1px solid #DCE8F3'
                            }}
                        >
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'space-between',
                                gap: 10,
                                flexWrap: 'wrap'
                            }}>
                                <h4>O que os dados mostram</h4>

                                <span style={{
                                    fontSize: 11,
                                    fontWeight: 700,
                                    color: '#168FC4'
                                }}>
                                    Análise comparativa
                                </span>
                            </div>

                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: 12,
                                marginTop: 16
                            }}>
                                {INDICADORES.map(indicador => (
                                    <p
                                        key={indicador.campo}
                                        style={{
                                            margin: 0,
                                            color: '#42576B',
                                            fontSize: 13,
                                            lineHeight: 1.7
                                        }}
                                    >
                                        {descreverComparacao(
                                            indicador.titulo,
                                            resultado.a[indicador.campo],
                                            resultado.b[indicador.campo],
                                            municipioAtual,
                                            municipioB.nome,
                                            indicador.campo === 'umidade'
                                                ? 'pontos percentuais'
                                                : indicador.unidade
                                        )}
                                    </p>
                                ))}
                            </div>

                            <p style={{
                                margin: '16px 0 0',
                                paddingTop: 12,
                                borderTop: '1px solid #DCE8F3',
                                color: '#8190A2',
                                fontSize: 11,
                                lineHeight: 1.6
                            }}>
                                Interpretação automática de estimativas
                                meteorológicas para dois pontos de referência,
                                no mesmo horário. As diferenças observadas
                                não permitem, isoladamente, determinar suas causas.
                            </p>
                        </article>
                    </details>

                    <div className="comparacao-grade">
                        {INDICADORES.map(indicador => {
                            const valorA =
                                resultado.a[indicador.campo];

                            const valorB =
                                resultado.b[indicador.campo];

                            const diferenca = valorB - valorA;

                            const escala = Math.max(
                                Math.abs(valorA),
                                Math.abs(valorB),
                                1
                            );

                            return (
                                <article
                                    key={indicador.campo}
                                    className="obs-bloco comparacao-grafico"
                                    style={{ marginBottom: 0 }}
                                >
                                    <h4>{indicador.titulo}</h4>

                                    {[
                                        {
                                            letra: 'A',
                                            valor: valorA,
                                            cor: '#168FC4'
                                        },
                                        {
                                            letra: 'B',
                                            valor: valorB,
                                            cor: '#E98645'
                                        }
                                    ].map(item => (
                                        <div
                                            key={item.letra}
                                            style={{ marginTop: 15 }}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                justifyContent:
                                                    'space-between',
                                                alignItems: 'center',
                                                gap: 8,
                                                fontSize: 12,
                                                marginBottom: 7
                                            }}>
                                                <span style={{
                                                    color: '#718096'
                                                }}>
                                                    {item.letra === 'A'
                                                        ? municipioAtual
                                                        : municipioB.nome}
                                                </span>

                                                <strong style={{
                                                    color: '#192942',
                                                    fontSize: 16
                                                }}>
                                                    {formatar(item.valor)}
                                                    {' '}
                                                    {indicador.unidade}
                                                </strong>
                                            </div>

                                            <div style={{
                                                height: 9,
                                                background: '#EAF0F6',
                                                borderRadius: 20,
                                                overflow: 'hidden'
                                            }}>
                                                <div className="comparacao-barra" style={{

                                                    height: '100%',
                                                    width: `${Math.max(
                                                        0,
                                                        item.valor / escala * 100
                                                    )}%`,
                                                    background: item.cor,
                                                    borderRadius: 20
                                                }} />
                                            </div>
                                        </div>
                                    ))}

                                    <div style={{
                                        marginTop: 17,
                                        paddingTop: 12,
                                        borderTop:
                                            '1px solid #E6EDF5',
                                        color: '#536B80',
                                        fontSize: 12
                                    }}>
                                        Diferença (B − A):{' '}
                                        <strong>
                                            {diferenca > 0 ? '+' : ''}
                                            {formatar(diferenca)}
                                            {' '}
                                            {indicador.campo === 'umidade'
                                                ? 'p.p.'
                                                : indicador.unidade}
                                        </strong>
                                    </div>
                                </article>
                            );
                        })}
                    </div>

                    <p className="comparacao-nota">
                        Fonte: Open-Meteo • Estimativas pontuais,
                        não médias municipais.
                    </p>
                </>
            )}
        </div>
    );
}
