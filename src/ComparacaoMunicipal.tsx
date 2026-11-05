
import { useEffect, useMemo, useState } from 'react';
import type { Feature, FeatureCollection } from 'geojson';
import { estacaoDentroDoMunicipio } from './estacoesMunicipais';
import { consultarOpenMeteoComCache } from './openMeteoCache';
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

type TipoArea = 'municipio' | 'distrito' | 'regional';

type AreaComparavel = {
    id: string;
    nome: string;
    tipo: TipoArea;
    latitude: number;
    longitude: number;
};

// Encontra uma referência dentro da área geográfica.
function obterPontoInterno(feature: Feature) {
    if (!feature.geometry) return null;

    const limites = L.geoJSON(feature).getBounds();

    if (!limites.isValid()) return null;

    const centro = limites.getCenter();

    const dentro = (latitude: number, longitude: number) =>
        estacaoDentroDoMunicipio(
            feature.geometry!,
            latitude,
            longitude
        );

    if (dentro(centro.lat, centro.lng)) {
        return {
            latitude: centro.lat,
            longitude: centro.lng
        };
    }

    // Para polígonos irregulares, procura um ponto interno.
    for (const divisao of [10, 25]) {
        let melhor: {
            latitude: number;
            longitude: number;
        } | null = null;

        let distanciaMenor = Infinity;

        for (let y = 0; y < divisao; y++) {
            for (let x = 0; x < divisao; x++) {
                const proporcaoX = (x + 0.5) / divisao;
                const proporcaoY = (y + 0.5) / divisao;

                const latitude =
                    limites.getSouth() +
                    proporcaoY *
                    (limites.getNorth() - limites.getSouth());

                const longitude =
                    limites.getWest() +
                    proporcaoX *
                    (limites.getEast() - limites.getWest());

                if (!dentro(latitude, longitude)) continue;

                const distancia =
                    (proporcaoX - 0.5) ** 2 +
                    (proporcaoY - 0.5) ** 2;

                if (distancia < distanciaMenor) {
                    distanciaMenor = distancia;
                    melhor = { latitude, longitude };
                }
            }
        }

        if (melhor) return melhor;
    }

    return null;
}

// Constrói as opções de distritos e regionais.
function mapearDivisoes(
    dados: FeatureCollection | null,
    tipo: 'distrito' | 'regional',
    municipio: string,
    nomeMunicipio: string
): AreaComparavel[] {
    return (dados?.features ?? []).flatMap((feature, indice) => {
        const codigo = String(
            feature.properties?.CD_DIST ??
            feature.properties?.id ??
            ''
        );

        const nome = String(
            feature.properties?.NM_DIST ??
            feature.properties?.regiao_adm ??
            feature.properties?.Nome ??
            `Área ${indice + 1}`
        ).trim();

        const ponto = obterPontoInterno(feature);

        if (!codigo || !ponto) return [];

        return [{
            id: `${tipo}:${municipio}:${codigo}`,
            nome: `${nome} (${nomeMunicipio})`,
            tipo,
            ...ponto
        }];
    });
}

const INDICADORES = [
    {
        campo: 'temperatura',
        titulo: 'Temperatura',
        unidade: '°C',
        cores: { clara: '#F6B78C', escura: '#D96C32' }
    },
    {
        campo: 'sensacao',
        titulo: 'Sensação térmica',
        unidade: '°C',
        cores: { clara: '#F5B1AE', escura: '#D95C60' }
    },
    {
        campo: 'umidade',
        titulo: 'Umidade relativa',
        unidade: '%',
        cores: { clara: '#91C9EC', escura: '#238DC4' }
    },
    {
        campo: 'vento',
        titulo: 'Velocidade do vento',
        unidade: 'km/h',
        cores: { clara: '#94D9CC', escura: '#24998B' }
    }
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
        return `A ${indicador.toLowerCase()} estimada é equivalente nas duas áreas, considerando a precisão apresentada.`;
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
    municipioAtual: municipioInicial,
    codigoAtual,
    latitudeAtual,
    longitudeAtual,
    municipios
}: Props) {
    const [codigoA, setCodigoA] =
        useState(`municipio:${codigoAtual}`);

    const [codigoB, setCodigoB] = useState('');

    const [dadosDistritos, setDadosDistritos] =
        useState<FeatureCollection | null>(null);

    const [dadosRegionais, setDadosRegionais] =
        useState<FeatureCollection | null>(null);

    const [avisosTerritoriais, setAvisosTerritoriais] =
        useState<string[]>([]);

    const [resultado, setResultado] =
        useState<Resultado | null>(null);

    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    // Carrega as divisões independentemente do município
    // que está aberto no Atlas.
    useEffect(() => {
        const controlador = new AbortController();

        const carregar = async (
            caminho: string,
            nome: string,
            aoCarregar: (dados: FeatureCollection) => void
        ) => {
            try {
                const resposta = await fetch(caminho, {
                    signal: controlador.signal
                });

                if (!resposta.ok) {
                    throw new Error('Arquivo indisponível');
                }

                const dados: FeatureCollection =
                    await resposta.json();

                if (
                    dados.type !== 'FeatureCollection' ||
                    !Array.isArray(dados.features) ||
                    dados.features.length === 0
                ) {
                    throw new Error('Dados geográficos inválidos');
                }

                if (!controlador.signal.aborted) {
                    aoCarregar(dados);
                }
            } catch {
                if (!controlador.signal.aborted) {
                    setAvisosTerritoriais(anteriores => [
                        ...anteriores,
                        `${nome} indisponíveis para comparação.`
                    ]);
                }
            }
        };

        void carregar(
            '/distritos-ipaporanga.geojson',
            'Distritos de Ipaporanga',
            setDadosDistritos
        );

        void carregar(
            '/regionais-fortaleza.geojson',
            'Regionais de Fortaleza',
            setDadosRegionais
        );

        return () => controlador.abort();
    }, []);

    // Reúne municípios, distritos e regionais
    // numa única coleção de áreas comparáveis.
    const listaAreas = useMemo<AreaComparavel[]>(() => {
        const areasMunicipais: AreaComparavel[] =
            (municipios?.features ?? []).flatMap(feature => {
                const codigo = String(
                    feature.properties?.id ?? ''
                );

                const nome = String(
                    feature.properties?.name ?? ''
                ).trim();

                if (!codigo || !nome || !feature.geometry) {
                    return [];
                }

                const usarReferenciaAtual =
                    codigo === codigoAtual &&
                    estacaoDentroDoMunicipio(
                        feature.geometry,
                        latitudeAtual,
                        longitudeAtual
                    );

                const ponto = usarReferenciaAtual
                    ? {
                        latitude: latitudeAtual,
                        longitude: longitudeAtual
                    }
                    : obterPontoInterno(feature);

                if (!ponto) return [];

                return [{
                    id: `municipio:${codigo}`,
                    nome,
                    tipo: 'municipio' as const,
                    ...ponto
                }];
            });

        return [
            ...areasMunicipais,
            ...mapearDivisoes(
                dadosDistritos,
                'distrito',
                '2305654',
                'Ipaporanga'
            ),
            ...mapearDivisoes(
                dadosRegionais,
                'regional',
                '2304400',
                'Fortaleza'
            )
        ].sort((a, b) =>
            a.nome.localeCompare(b.nome, 'pt-BR')
        );
    }, [
        municipios,
        codigoAtual,
        latitudeAtual,
        longitudeAtual,
        dadosDistritos,
        dadosRegionais
    ]);

    const areaA = listaAreas.find(
        area => area.id === codigoA
    );

    const areaB = listaAreas.find(
        area => area.id === codigoB
    );

    // Mantém compatibilidade com os gráficos e
    // com a análise textual que já existem.
    const municipioAtual = areaA?.nome ?? municipioInicial;

    const municipioB = areaB
        ? { nome: areaB.nome }
        : null;

    // Consulta duas coordenadas na mesma requisição.
    useEffect(() => {
        const controlador = new AbortController();

        setResultado(null);
        setErro(null);

        if (!codigoA || !codigoB) {
            setCarregando(false);
            return () => controlador.abort();
        }

        if (codigoA === codigoB) {
            setCarregando(false);
            setErro('Escolha duas áreas diferentes.');
            return () => controlador.abort();
        }

        if (!areaA || !areaB) {
            setCarregando(false);
            setErro('Uma das áreas ainda não está disponível.');
            return () => controlador.abort();
        }

        setCarregando(true);

        const consultar = async () => {
            try {
                const parametros = new URLSearchParams({
                    latitude: [
                        areaA.latitude,
                        areaB.latitude
                    ].map(valor => valor.toFixed(5)).join(','),

                    longitude: [
                        areaA.longitude,
                        areaB.longitude
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

                const dados: unknown =
                    await consultarOpenMeteoComCache(
                        `https://api.open-meteo.com/v1/forecast?${parametros.toString()}`,
                        controlador.signal
                    );

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
                            : 'Não foi possível comparar as áreas.'
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
    }, [codigoA, codigoB, areaA, areaB]);

    return (
        <div>
            <article className="obs-bloco">
                <h4>Selecionar áreas</h4>

                <div
                    style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                        gap: '10px',
                        marginTop: '12px'
                    }}
                >
                    {(['A', 'B'] as const).map(letra => (
                        <label
                            key={letra}
                            style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                minWidth: 0,
                                fontSize: '12px',
                                color: '#536B80',
                                fontWeight: 700
                            }}
                        >
                            Área {letra}

                            <select
                                aria-label={`Selecionar Área ${letra}`}
                                value={letra === 'A' ? codigoA : codigoB}
                                onChange={evento => {
                                    if (letra === 'A') {
                                        setCodigoA(evento.target.value);
                                    } else {
                                        setCodigoB(evento.target.value);
                                    }
                                }}
                                style={{
                                    width: '100%',
                                    minWidth: 0,
                                    padding: '10px 8px',
                                    border: '1px solid #DCE8F3',
                                    borderRadius: '10px',
                                    background: '#F5F9FD',
                                    color: '#192942',
                                    font: 'inherit',
                                    fontWeight: 600
                                }}
                            >
                                <option value="">Selecione uma área</option>

                                <optgroup label="Municípios do Ceará">
                                    {listaAreas
                                        .filter(area => area.tipo === 'municipio')
                                        .map(area => (
                                            <option
                                                key={area.id}
                                                value={area.id}
                                                disabled={
                                                    area.id === (
                                                        letra === 'A'
                                                            ? codigoB
                                                            : codigoA
                                                    )
                                                }
                                            >
                                                {area.nome}
                                            </option>
                                        ))}
                                </optgroup>

                                <optgroup label="Distritos de Ipaporanga">
                                    {listaAreas
                                        .filter(area => area.tipo === 'distrito')
                                        .map(area => (
                                            <option
                                                key={area.id}
                                                value={area.id}
                                                disabled={
                                                    area.id === (
                                                        letra === 'A'
                                                            ? codigoB
                                                            : codigoA
                                                    )
                                                }
                                            >
                                                {area.nome}
                                            </option>
                                        ))}
                                </optgroup>

                                <optgroup label="Regionais de Fortaleza">
                                    {listaAreas
                                        .filter(area => area.tipo === 'regional')
                                        .map(area => (
                                            <option
                                                key={area.id}
                                                value={area.id}
                                                disabled={
                                                    area.id === (
                                                        letra === 'A'
                                                            ? codigoB
                                                            : codigoA
                                                    )
                                                }
                                            >
                                                {area.nome}
                                            </option>
                                        ))}
                                </optgroup>
                            </select>
                        </label>
                    ))}
                </div>

                {avisosTerritoriais.length > 0 && (
                    <p
                        style={{
                            fontSize: '11px',
                            color: '#A64B3B',
                            marginTop: '10px'
                        }}
                    >
                        {avisosTerritoriais.join(' ')}
                    </p>
                )}

            </article>

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
                                            cor: valorA > valorB
                                                ? indicador.cores.escura
                                                : indicador.cores.clara
                                        },
                                        {
                                            letra: 'B',
                                            valor: valorB,
                                            cor: valorB > valorA
                                                ? indicador.cores.escura
                                                : indicador.cores.clara
                                        }
                                    ].map(item => (
                                        <div
                                            key={item.letra}
                                            style={{ marginTop: 8 }}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                justifyContent:
                                                    'space-between',
                                                alignItems: 'center',
                                                gap: 8,
                                                fontSize: 12,
                                                marginBottom: 4
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
                                                    fontSize: 13
                                                }}>
                                                    {formatar(item.valor)}
                                                    {' '}
                                                    {indicador.unidade}
                                                </strong>
                                            </div>

                                            <div style={{
                                                height: 6,
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
                                        marginTop: 10,
                                        paddingTop: 8,
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
                        não médias territoriais.
                    </p>
                </>
            )}
        </div>
    );
}
