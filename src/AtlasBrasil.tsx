import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    estacaoDentroDoMunicipio,
    type EstacaoPublica
} from './estacoesMunicipais';
import ObservatorioMunicipal from './ObservatorioMunicipal';
import type { PerfilTermicoMunicipal } from './perfilTermicoMunicipal';
import {
    MapContainer,
    GeoJSON,
    TileLayer,
    Polygon,
    CircleMarker,
    Tooltip,
    Popup,
    useMap
} from 'react-leaflet';
import L from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';

type EstadoAtlas = {
    codigo: string;
    nome: string;
    sigla: string;
};

type MunicipioAtlas = {
    codigo: string;
    nome: string;
};

const CORES_BRASIL: Record<string, string> = {
    N: '#65B58A',
    NE: '#E8B65D',
    CO: '#B49ADE',
    SE: '#CE84AE',
    S: '#58B8CF'
};

// Chaves sem acentos para tolerar diferenças de grafia.
const CORES_CEARA: Record<string, string> = {
    'cariri': '#D7A2DE',
    'centro sul': '#8DC9B0',
    'grande fortaleza': '#F4B481',
    'litoral leste': '#8BBFE3',
    'litoral norte': '#75D0C1',
    'litoral oeste vale do curu': '#B2D6A2',
    'macico de baturite': '#97BB80',
    'serra da ibiapaba': '#B9A3E8',
    'sertao central': '#E2C77B',
    'sertao de crateus': '#80BED6',
    'sertao dos inhamus': '#E6A0A4',
    'sertao de caninde': '#C5B9E8',
    'sertao de sobral': '#EDA7CC',
    'vale do jaguaribe': '#E9B285'
};

// CORES DOS DISTRITOS — DESTAQUE SOMENTE AO PASSAR O MOUSE
const CORES_DISTRITOS = [
    '#2688D9', // Azul
    '#E5A13A', // Laranja
    '#9165C7', // Roxo
    '#28A899', // Turquesa
    '#DB7796', // Rosa
    '#8AAE43', // Verde oliva
    '#CF7650', // Terracota
    '#6387BD'  // Azul acinzentado
];

function chaveRegiao(nome: string) {
    return nome
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}


// Paleta relativa às temperaturas da amostra.
// Azul: valor mais baixo. Laranja: valor mais alto.
function corPontoTermico(
    temperatura: number,
    minima: number,
    maxima: number
): string {
    const amplitude = maxima - minima;

    const proporcao = amplitude > 0
        ? Math.max(
            0,
            Math.min(1, (temperatura - minima) / amplitude)
        )
        : 0.5;

    const fria = [54, 161, 201];
    const quente = [236, 128, 72];

    const canais = fria.map((valor, indice) =>
        Math.round(
            valor +
            (quente[indice] - valor) * proporcao
        )
    );

    return `rgb(${canais.join(',')})`;
}





function EnquadramentoAtlas({
    dados,
    estado,
    municipios,
    municipio,
    distritos,
    distritoSelecionado
}: {
    dados: FeatureCollection;
    estado: EstadoAtlas | null;
    municipios: FeatureCollection | null;
    municipio: MunicipioAtlas | null;
    distritos: FeatureCollection | null;
    distritoSelecionado: string | null;
}) {
    const map = useMap();

    useEffect(() => {
        // Identifica o distrito selecionado.
        // Identifica a divisão territorial selecionada.
        const distritoAtual = distritos?.features.find(
            item =>
                String(
                    item.properties?.CD_DIST ??
                    item.properties?.id ??
                    ''
                ) === distritoSelecionado
        );

        // Prioriza a área selecionada, depois a malha completa.
        const geometria = distritoAtual
            ?? (
                municipio && distritos
                    ? distritos
                    : municipio && municipios
                        ? municipios.features.find(
                            item =>
                                String(item.properties?.id) === municipio.codigo
                        )
                        : estado
                            ? dados.features.find(
                                item =>
                                    String(item.properties?.CD_UF) === estado.codigo
                            )
                            : dados
            );
        if (!geometria) return;

        const limites = L.geoJSON(geometria).getBounds();

        if (!limites.isValid()) return;

        let quadro = 0;

        // Mantém o território inteiro e centralizado
        // durante todo o redimensionamento do mapa.
        const ajustarEnquadramento = () => {
            cancelAnimationFrame(quadro);

            quadro = requestAnimationFrame(() => {
                // Primeiro, informa ao Leaflet a largura atual.
                map.invalidateSize({
                    pan: false,
                    animate: false
                });

                // Depois, ajusta a geometria à largura atual.
                map.fitBounds(limites, {
                    padding: [28, 28],
                    maxZoom: distritoAtual ? 13 : undefined,
                    animate: true
                });
            });
        };

        // Detecta continuamente as mudanças de largura.
        const observador = new ResizeObserver(
            ajustarEnquadramento
        );

        observador.observe(map.getContainer());

        // Enquadramento inicial, inclusive após um clique.
        ajustarEnquadramento();

        return () => {
            observador.disconnect();
            cancelAnimationFrame(quadro);
        };
    }, [
        map,
        dados,
        estado,
        municipios,
        municipio,
        distritos,
        distritoSelecionado
    ]);

    return null;
}



type PropsAtlas = {
    estacoes: EstacaoPublica[];
    carregandoEstacoes: boolean;
    erroEstacoes: string | null;
    instanteAtual: number;
};

export default function AtlasBrasil({
    estacoes,
    carregandoEstacoes,
    erroEstacoes,
    instanteAtual
}: PropsAtlas) {
    const [dados, setDados] = useState<FeatureCollection | null>(null);
    const [estado, setEstado] = useState<EstadoAtlas | null>(null);
    const [municipios, setMunicipios] = useState<FeatureCollection | null>(null);
    const [municipio, setMunicipio] = useState<MunicipioAtlas | null>(null);

    // DISTRITOS DE IPAPORANGA
    const [distritosIpaporanga, setDistritosIpaporanga] =
        useState<FeatureCollection | null>(null);

    const [distritoSelecionado, setDistritoSelecionado] =
        useState<string | null>(null);

    const [erroDistritos, setErroDistritos] =
        useState<string | null>(null);
    // REGIONAIS ADMINISTRATIVAS DE FORTALEZA
    const [regionaisFortaleza, setRegionaisFortaleza] =
        useState<FeatureCollection | null>(null);

    const [erroRegionais, setErroRegionais] =
        useState<string | null>(null);
    const [regioesPorMunicipio, setRegioesPorMunicipio] = useState<Record<string, string>>({});
    const [carregandoMunicipios, setCarregandoMunicipios] = useState(false);
    const [erro, setErro] = useState('');
    const [idEstacaoSelecionada, setIdEstacaoSelecionada] =
        useState<string | null>(null);


    // VISUALIZAÇÃO DAS AMOSTRAS TÉRMICAS
    const [mostrarAmostras, setMostrarAmostras] =
        useState(false);


    const [erroAmostras, setErroAmostras] =
        useState<string | null>(null);

    const [perfilMapa, setPerfilMapa] =
        useState<{
            codigo: string;
            distrito: string | null;
            perfil: PerfilTermicoMunicipal;
        } | null>(null);

    const codigoMunicipioSelecionado =
        municipio?.codigo ?? null;

    const codigoDistritoAtivo =
        municipio?.codigo === '2305654' ||
            municipio?.codigo === '2304400'
            ? distritoSelecionado
            : null;

    // Recebe o perfil calculado para o território atual.
    const receberPerfilTermico = useCallback(
        (
            perfil: PerfilTermicoMunicipal | null,
            erro: string | null = null
        ) => {
            setErroAmostras(erro);
            setPerfilMapa(
                perfil && codigoMunicipioSelecionado
                    ? {
                        codigo: codigoMunicipioSelecionado,
                        distrito: codigoDistritoAtivo,
                        perfil
                    }
                    : null
            );
        },
        [codigoMunicipioSelecionado, codigoDistritoAtivo]
    );

    // Evita exibir amostras de outro distrito.
    const perfilMunicipio =
        perfilMapa?.codigo === codigoMunicipioSelecionado &&
            perfilMapa?.distrito === codigoDistritoAtivo
            ? perfilMapa.perfil
            : null;


    useEffect(() => {
        const controlador = new AbortController();
        fetch('/estados-brasil.geojson', { signal: controlador.signal })
            .then(resposta => {
                if (!resposta.ok) throw new Error('Mapa do Brasil não encontrado');
                return resposta.json();
            })
            .then((resultado: FeatureCollection) => {
                if (!controlador.signal.aborted) setDados(resultado);
            })
            .catch(erroCarregamento => {
                if (!controlador.signal.aborted) {
                    console.error(erroCarregamento);
                    setErro('Não foi possível carregar o mapa do Brasil.');
                }
            });
        return () => controlador.abort();
    }, []);

    useEffect(() => {
        if (estado?.sigla !== 'CE') {
            setMunicipios(null);
            setMunicipio(null);
            setRegioesPorMunicipio({});
            setCarregandoMunicipios(false);
            return;
        }

        const controlador = new AbortController();
        setCarregandoMunicipios(true);
        setErro('');

        fetch('/municipios-ceara.geojson', { signal: controlador.signal })
            .then(resposta => {
                if (!resposta.ok) throw new Error('Mapa dos municípios não encontrado');
                return resposta.json();
            })
            .then((resultado: FeatureCollection) => {
                if (resultado.type !== 'FeatureCollection' || !Array.isArray(resultado.features)) {
                    throw new Error('GeoJSON municipal inválido');
                }
                if (!controlador.signal.aborted) setMunicipios(resultado);
            })
            .catch(erroCarregamento => {
                if (!controlador.signal.aborted) {
                    console.error(erroCarregamento);
                    setErro('Não foi possível carregar os municípios.');
                }
            })
            .finally(() => {
                if (!controlador.signal.aborted) setCarregandoMunicipios(false);
            });

        // Cores regionais independentes: uma falha não impede os municípios de aparecerem.
        fetch('/regioes-ceara.json', { signal: controlador.signal })
            .then(resposta => {
                if (!resposta.ok) throw new Error('Tabela de regiões não encontrada');
                return resposta.json();
            })
            .then((resultado: Record<string, string>) => {
                if (!controlador.signal.aborted) setRegioesPorMunicipio(resultado);
            })
            .catch(erroCarregamento => {
                if (!controlador.signal.aborted) {
                    console.error('Cores regionais indisponíveis:', erroCarregamento);
                }
            });

        return () => controlador.abort();
    }, [estado?.sigla]);

    // CARREGAMENTO DA MALHA DISTRITAL DE IPAPORANGA
    useEffect(() => {
        setDistritosIpaporanga(null);
        setDistritoSelecionado(null);
        setErroDistritos(null);

        if (municipio?.codigo !== '2305654') return;

        const controlador = new AbortController();

        fetch('/distritos-ipaporanga.geojson', {
            signal: controlador.signal
        })
            .then(resposta => {
                if (!resposta.ok) {
                    throw new Error('GeoJSON dos distritos não encontrado.');
                }
                return resposta.json();
            })
            .then((resultado: FeatureCollection) => {
                if (
                    resultado.type !== 'FeatureCollection' ||
                    !Array.isArray(resultado.features) ||
                    resultado.features.length === 0
                ) {
                    throw new Error('GeoJSON distrital inválido.');
                }

                if (!controlador.signal.aborted) {
                    setDistritosIpaporanga(resultado);
                }
            })
            .catch(erro => {
                if (!controlador.signal.aborted) {
                    console.error(erro);
                    setErroDistritos('Não foi possível carregar os distritos.');
                }
            });

        return () => controlador.abort();

    }, [municipio?.codigo]);

    // CARREGAMENTO DAS 12 REGIONAIS DE FORTALEZA
    useEffect(() => {
        setRegionaisFortaleza(null);
        setErroRegionais(null);

        // Código IBGE de Fortaleza
        if (municipio?.codigo !== '2304400') return;

        const controlador = new AbortController();

        fetch('/regionais-fortaleza.geojson', {
            signal: controlador.signal
        })
            .then(resposta => {
                if (!resposta.ok) {
                    throw new Error(
                        'GeoJSON das Regionais não encontrado.'
                    );
                }

                return resposta.json();
            })
            .then((resultado: FeatureCollection) => {
                if (
                    resultado.type !== 'FeatureCollection' ||
                    !Array.isArray(resultado.features) ||
                    resultado.features.length !== 12
                ) {
                    throw new Error(
                        'A malha deve conter 12 Regionais.'
                    );
                }

                if (!controlador.signal.aborted) {
                    setRegionaisFortaleza(resultado);
                }
            })
            .catch(erro => {
                if (!controlador.signal.aborted) {
                    console.error(erro);
                    setErroRegionais(
                        'Não foi possível carregar as Regionais.'
                    );
                }
            });

        return () => controlador.abort();

    }, [municipio?.codigo]);

    // CARREGAMENTO DAS REGIONAIS DE FORTALEZA
    useEffect(() => {
        setRegionaisFortaleza(null);
        setErroRegionais(null);

        if (municipio?.codigo !== '2304400') return;

        const controlador = new AbortController();

        fetch('/regionais-fortaleza.geojson', {
            signal: controlador.signal
        })
            .then(resposta => {
                if (!resposta.ok) {
                    throw new Error('Malha de Fortaleza não encontrada.');
                }
                return resposta.json();
            })
            .then((resultado: FeatureCollection) => {
                if (
                    resultado.type !== 'FeatureCollection' ||
                    !Array.isArray(resultado.features) ||
                    resultado.features.length !== 12
                ) {
                    throw new Error('Malha das Regionais inválida.');
                }

                if (!controlador.signal.aborted) {
                    setRegionaisFortaleza(resultado);
                }
            })
            .catch(falha => {
                if (!controlador.signal.aborted) {
                    console.error(falha);
                    setErroRegionais('Não foi possível carregar as Regionais.');
                }
            });

        return () => controlador.abort();
    }, [municipio?.codigo]);

    const estaNoCeara = estado?.sigla === 'CE';

    const geometriaEstado = dados && estado
        ? dados.features.find(
            feature => String(feature.properties?.CD_UF) === estado.codigo
        )
        : null;

    const geometriaMunicipio = municipios && municipio
        ? municipios.features.find(
            feature => String(feature.properties?.id) === municipio.codigo
        )
        : null;

    // MALHA TERRITORIAL ATIVA
    const divisoesAtivas =
        municipio?.codigo === '2305654'
            ? distritosIpaporanga
            : municipio?.codigo === '2304400'
                ? regionaisFortaleza
                : null;

    const erroTerritorial =
        municipio?.codigo === '2304400'
            ? erroRegionais
            : erroDistritos;

    // GEOMETRIA DA DIVISÃO TERRITORIAL SELECIONADA
    const geometriaDistritoSelecionado = useMemo(() => {
        if (!divisoesAtivas || !distritoSelecionado) {
            return null;
        }

        return divisoesAtivas.features.find(
            feature =>
                String(
                    feature.properties?.CD_DIST ??
                    feature.properties?.id ??
                    ''
                ) === distritoSelecionado
        ) ?? null;

    }, [divisoesAtivas, distritoSelecionado]);

    // Estações efetivamente localizadas no município.
    const estacoesDoMunicipio = useMemo(() => {
        if (!geometriaMunicipio) return [];

        return estacoes.filter(estacao =>
            estacaoDentroDoMunicipio(
                geometriaMunicipio.geometry,
                estacao.latitude,
                estacao.longitude
            )
        );
    }, [estacoes, geometriaMunicipio]);

    // ESTAÇÕES DO TERRITÓRIO ATUAL
    const estacoesDoTerritorio = useMemo(() => {
        if (!geometriaDistritoSelecionado) {
            return estacoesDoMunicipio;
        }

        return estacoesDoMunicipio.filter(estacao =>
            estacaoDentroDoMunicipio(
                geometriaDistritoSelecionado.geometry,
                estacao.latitude,
                estacao.longitude
            )
        );
    }, [estacoesDoMunicipio, geometriaDistritoSelecionado]);

    const idEstacaoAtiva = estacoesDoTerritorio.some(
        estacao => estacao.id === idEstacaoSelecionada
    )
        ? idEstacaoSelecionada
        : null;

    // PONTO DE REFERÊNCIA METEOROLÓGICA DO MUNICÍPIO
    const pontoReferenciaMunicipio = useMemo(() => {
        if (!geometriaMunicipio) return null;

        const limites = L.geoJSON(
            geometriaMunicipio
        ).getBounds();

        if (!limites.isValid()) return null;

        const centro = limites.getCenter();

        return {
            latitude: centro.lat,
            longitude: centro.lng
        };
    }, [geometriaMunicipio]);


    // PONTO DE REFERÊNCIA DO DISTRITO
    const pontoReferenciaDistrito = useMemo(() => {
        const feature = geometriaDistritoSelecionado;

        if (!feature) return null;

        const limites = L.geoJSON(feature).getBounds();

        if (!limites.isValid()) return null;

        const centro = limites.getCenter();

        const dentro = (latitude: number, longitude: number) =>
            estacaoDentroDoMunicipio(
                feature.geometry,
                latitude,
                longitude
            );

        if (dentro(centro.lat, centro.lng)) {
            return {
                latitude: centro.lat,
                longitude: centro.lng
            };
        }

        // Busca o ponto interno mais próximo do centro.
        let melhor: {
            latitude: number;
            longitude: number;
        } | null = null;

        let menorDistancia = Infinity;
        const divisoes = 25;

        for (let linha = 0; linha < divisoes; linha++) {
            for (let coluna = 0; coluna < divisoes; coluna++) {
                const y = (linha + 0.5) / divisoes;
                const x = (coluna + 0.5) / divisoes;

                const latitude = limites.getSouth() +
                    y * (limites.getNorth() - limites.getSouth());

                const longitude = limites.getWest() +
                    x * (limites.getEast() - limites.getWest());

                if (!dentro(latitude, longitude)) continue;

                const distancia =
                    (x - 0.5) ** 2 + (y - 0.5) ** 2;

                if (distancia < menorDistancia) {
                    menorDistancia = distancia;
                    melhor = { latitude, longitude };
                }
            }
        }

        return melhor;
    }, [geometriaDistritoSelecionado]);

    // Referência ativa: distrito ou município.
    const pontoReferenciaArea =
        geometriaDistritoSelecionado
            ? pontoReferenciaDistrito
            : pontoReferenciaMunicipio;


    const geometriaAtual = estaNoCeara && municipios
        ? geometriaMunicipio ?? municipios
        : geometriaEstado ?? dados;

    // Máscara geográfica: o mapa-base aparece SOMENTE dentro do município.
    const mascaraExterna = useMemo<L.LatLngExpression[][] | null>(() => {
        const geometria = geometriaMunicipio?.geometry;
        if (!geometria) return null;

        const aneis: L.LatLngExpression[][] = [];
        if (geometria.type === 'Polygon') {
            aneis.push(geometria.coordinates[0].map(
                ([longitude, latitude]): L.LatLngExpression => [latitude, longitude]
            ));
        } else if (geometria.type === 'MultiPolygon') {
            for (const poligono of geometria.coordinates) {
                aneis.push(poligono[0].map(
                    ([longitude, latitude]): L.LatLngExpression => [latitude, longitude]
                ));
            }
        }
        if (!aneis.length) return null;

        const exterior: L.LatLngExpression[] = [
            [-38, -80], [-38, -25], [10, -25], [10, -80]
        ];
        return [exterior, ...aneis];
    }, [geometriaMunicipio]);


    const mostrandoMalhaDistrital =
        divisoesAtivas !== null;


    // MÁSCARA GEOGRÁFICA DO DISTRITO SELECIONADO
    const mascaraDistritoSelecionado =
        useMemo<L.LatLngExpression[][] | null>(() => {

            const geometria = geometriaDistritoSelecionado?.geometry;

            if (
                !geometria ||
                (
                    geometria.type !== 'Polygon' &&
                    geometria.type !== 'MultiPolygon'
                )
            ) {
                return null;
            }

            const aneis = geometria.type === 'Polygon'
                ? geometria.coordinates
                : geometria.coordinates.flat();

            const exterior: L.LatLngExpression[] = [
                [-38, -80],
                [-38, -25],
                [10, -25],
                [10, -80]
            ];

            const interiores = aneis.map(anel =>
                anel.map(
                    ([longitude, latitude]): L.LatLngExpression =>
                        [latitude, longitude]
                )
            );

            return [exterior, ...interiores];

        }, [geometriaDistritoSelecionado]);

    // Decide qual limite deve ficar visível.
    const mascaraVisual =
        geometriaDistritoSelecionado
            ? (mascaraDistritoSelecionado ?? mascaraExterna)
            : mascaraExterna;

    // FILTRA OS PONTOS TÉRMICOS PELO DISTRITO SELECIONADO
    const pontosVisiveis = perfilMunicipio?.pontos.filter(ponto => {
        if (!geometriaDistritoSelecionado) return true;

        return estacaoDentroDoMunicipio(
            geometriaDistritoSelecionado.geometry,
            ponto.latitude,
            ponto.longitude
        );
    }) ?? [];

    const estiloTerritorio = (feature?: Feature): L.PathOptions => {
        if (municipio) {
            // Evita sobrepor dois contornos territoriais
            // quando estamos exibindo os distritos.
            if (mostrandoMalhaDistrital) {
                return {
                    color: 'transparent',
                    weight: 0,
                    opacity: 0,
                    fillOpacity: 0,
                    interactive: false
                };
            }

            return {
                color: '#087CDB',
                weight: 2.4,
                opacity: 1,
                fillOpacity: 0,
                interactive: false
            };
        }

        if (estaNoCeara && municipios) {
            const codigo = String(feature?.properties?.id ?? '');
            const regiao = regioesPorMunicipio[codigo];
            return {
                color: '#FFFFFF',
                weight: 1.2,
                opacity: 0.95,
                fillColor: regiao
                    ? CORES_CEARA[chaveRegiao(regiao)] ?? '#D6E4F0'
                    : '#D6E4F0',
                fillOpacity: 1
            };
        }

        if (estado) {
            return {
                color: '#087CDB', weight: 2.4, fillColor: '#D6E4F0', fillOpacity: 1
            };
        }

        const regiaoBrasil = String(feature?.properties?.SIGLA_RG ?? '');
        return {
            color: '#FFFFFF', weight: 1.5,
            fillColor: CORES_BRASIL[regiaoBrasil] ?? '#D6E4F0',
            fillOpacity: 1
        };
    };

    const nomeRegiaoSelecionada = municipio
        ? regioesPorMunicipio[municipio.codigo]
        : null;

    const legendaRegioes = Array.from(new Set(Object.values(regioesPorMunicipio)))
        .sort((a, b) => a.localeCompare(b, 'pt-BR'));

    return (
        <div className="atlas-cuidai" style={{ width: '100%' }}>
            <div style={{
                display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap',
                marginBottom: '16px'
            }}>
                <div>
                    <div style={{
                        color: '#168FC4', fontSize: '11px', fontWeight: 800,
                        letterSpacing: '1px'
                    }}>CUIDAÍ | ATLAS DO TERRITÓRIO</div>
                    <h3 style={{ margin: '6px 0 4px', fontSize: '26px', color: '#192942' }}>
                        {municipio ? municipio.nome : estado ? estado.nome : 'Brasil'}
                    </h3>
                    <p style={{ color: '#718096', fontSize: '13px', margin: 0 }}>
                        {municipio
                            ? `${nomeRegiaoSelecionada ?? 'Município selecionado'} • ${estado?.nome}`
                            : estaNoCeara
                                ? carregandoMunicipios
                                    ? 'Carregando municípios...'
                                    : `${municipios?.features.length ?? 0} municípios • Selecione um município`
                                : estado
                                    ? 'Estado selecionado'
                                    : 'Selecione um estado para explorar o território'}
                    </p>
                </div>
                {estado && (
                    <button type="button" onClick={() => {
                        if (municipio) setMunicipio(null);
                        else setEstado(null);
                    }} style={{
                        border: '1px solid #D8E6F3', background: '#F4F9FD',
                        color: '#087CDB', borderRadius: '10px', padding: '10px 14px',
                        cursor: 'pointer', fontWeight: 700
                    }}>
                        {municipio ? 'Voltar ao Ceará' : 'Voltar ao Brasil'}
                    </button>
                )}
            </div>

            {erro && <p style={{ color: '#B42318' }}>{erro}</p>}

            {/* ATLAS COM PAINEL ESTATÍSTICO LATERAL */}
            <div
                className={
                    municipio
                        ? 'atlas-layout atlas-layout--municipio'
                        : 'atlas-layout'
                }
            >
                <div
                    className="atlas-layout__mapa"
                    style={{
                        height: 'min(85vh, 850px)',
                        minHeight: '620px',
                        width: '100%',
                        borderRadius: '14px',
                        overflow: 'hidden',
                        background: '#F3F7FB'
                    }}
                >
                    <MapContainer center={[-14.5, -52]} zoom={4} zoomSnap={0}
                        zoomControl={false} scrollWheelZoom={false} doubleClickZoom={false}
                        style={{ width: '100%', height: '100%', background: '#F3F7FB' }}>



                        {dados && (
                            <>
                                <EnquadramentoAtlas
                                    dados={dados}
                                    estado={estado}
                                    municipios={municipios}
                                    municipio={municipio}
                                    distritos={divisoesAtivas}
                                    distritoSelecionado={distritoSelecionado}
                                />

                                {/* Nível municipal: base geográfica real. */}
                                {municipio && (
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        attribution="&copy; OpenStreetMap contributors"
                                        maxZoom={19}
                                    />
                                )}

                                {/* Mantém a máscara nos outros municípios.
    Em Ipaporanga, a camada distrital fica sem recorte externo. */}
                                {/* OCULTA O MAPA FORA DO TERRITÓRIO ATUAL */}
                                {municipio && mascaraVisual && (
                                    <Polygon
                                        positions={mascaraVisual}
                                        pathOptions={{
                                            stroke: false,
                                            fillColor: '#F3F7FB',
                                            fillOpacity: 1,
                                            fillRule: 'evenodd',
                                            interactive: false
                                        }}
                                    />
                                )}

                                <GeoJSON
                                    key={municipio
                                        ? `municipio-${municipio.codigo}`
                                        : estaNoCeara && municipios
                                            ? `municipios-ceara-${Object.keys(regioesPorMunicipio).length}`
                                            : estado ? `estado-${estado.codigo}` : 'brasil'}
                                    data={geometriaAtual ?? dados}
                                    style={estiloTerritorio}
                                    onEachFeature={(feature, layer) => {
                                        if (municipio) return; // Sem hover que pinta o município inteiro.
                                        const nome = String(
                                            feature.properties?.name ?? feature.properties?.NM_UF ?? ''
                                        );
                                        const codigo = String(feature.properties?.id ?? '');
                                        const regiao = regioesPorMunicipio[codigo];
                                        const etiqueta = estaNoCeara && regiao
                                            ? `${nome} • ${regiao}` : nome;
                                        if (etiqueta) layer.bindTooltip(etiqueta, {
                                            sticky: true, direction: 'top'
                                        });
                                        layer.on('mouseover', () => {
                                            (layer as L.Path).setStyle({
                                                color: '#087CDB', weight: 2.5,
                                                fillColor: '#90CBF5', fillOpacity: 1
                                            });
                                        });
                                        layer.on('mouseout', () => {
                                            (layer as L.Path).setStyle(estiloTerritorio(feature));
                                        });
                                        layer.on('click', () => {
                                            if (!estado) {
                                                setEstado({
                                                    codigo: String(feature.properties?.CD_UF ?? ''),
                                                    nome: String(feature.properties?.NM_UF ?? ''),
                                                    sigla: String(feature.properties?.SIGLA_UF ?? '')
                                                });
                                            } else if (estaNoCeara && municipios) {
                                                if (!codigo) return;
                                                setMostrarAmostras(false);
                                                setPerfilMapa(null);
                                                setMunicipio({ codigo, nome });
                                            }
                                        });
                                    }}
                                />

                                {/* A seleção distrital é controlada pela camada abaixo. */}
                                {/* LIMITES INTERATIVOS DOS DISTRITOS DE IPAPORANGA */}
                                {divisoesAtivas && (
                                    <GeoJSON
                                        key={`divisoes-${municipio?.codigo}-${distritoSelecionado ?? 'todos'}`}
                                        data={
                                            geometriaDistritoSelecionado
                                                ? geometriaDistritoSelecionado
                                                : divisoesAtivas
                                        }

                                        style={() => ({
                                            color: '#66A7D3',
                                            weight: 1.5,
                                            opacity: 1,
                                            fillColor: '#FFFFFF',
                                            fillOpacity: 0.01
                                        })}

                                        onEachFeature={(feature, layer) => {
                                            const codigo = String(
                                                feature.properties?.CD_DIST ??
                                                feature.properties?.id ??
                                                ''
                                            );

                                            const nome = String(
                                                feature.properties?.NM_DIST ??
                                                feature.properties?.regiao_adm ??
                                                'Área'
                                            );

                                            const indice = municipio?.codigo === '2304400'
                                                ? Number(feature.properties?.id) - 1
                                                : divisoesAtivas.features.findIndex(
                                                    item =>
                                                        String(item.properties?.CD_DIST) === codigo
                                                );

                                            const cor = CORES_DISTRITOS[
                                                Math.max(0, indice) % CORES_DISTRITOS.length
                                            ];

                                            const camada = layer as L.Path;

                                            layer.bindTooltip(nome, {
                                                sticky: true,
                                                direction: 'top'
                                            });

                                            // COLORIR AO PASSAR O MOUSE
                                            layer.on('mouseover', () => {
                                                camada.setStyle({
                                                    color: cor,
                                                    weight: 2.5,
                                                    fillColor: cor,
                                                    fillOpacity: 0.28
                                                });

                                                camada.bringToFront();
                                            });

                                            // RETIRAR A COR AO SAIR
                                            layer.on('mouseout', () => {
                                                camada.setStyle({
                                                    color: '#66A7D3',
                                                    weight: 1.5,
                                                    fillColor: '#FFFFFF',
                                                    fillOpacity: 0.01
                                                });
                                            });

                                            // SELECIONAR DISTRITO PARA ZOOM
                                            layer.on('click', () => {
                                                setDistritoSelecionado(atual =>
                                                    atual === codigo ? null : codigo
                                                );
                                            });
                                        }}
                                    />
                                )}

                                {/* PONTOS DA AMOSTRAGEM TÉRMICA MUNICIPAL */}
                                {municipio &&
                                    mostrarAmostras &&
                                    perfilMunicipio &&
                                    pontosVisiveis.map((ponto, indice) => (
                                        <CircleMarker
                                            key={`${municipio.codigo}-amostra-${indice}`}
                                            center={[ponto.latitude, ponto.longitude]}
                                            radius={6}
                                            pathOptions={{
                                                color: '#FFFFFF',
                                                weight: 2,
                                                fillColor: corPontoTermico(
                                                    ponto.temperatura,
                                                    perfilMunicipio.minima,
                                                    perfilMunicipio.maxima
                                                ),
                                                fillOpacity: 0.95
                                            }}
                                        >
                                            <Tooltip
                                                direction="top"
                                                offset={[0, -8]}
                                                opacity={1}
                                            >
                                                <div style={{ lineHeight: 1.5 }}>
                                                    <strong>Amostra {indice + 1}</strong>
                                                    <div>
                                                        {ponto.temperatura.toFixed(1)
                                                            .replace('.', ',')} °C
                                                    </div>
                                                </div>
                                            </Tooltip>

                                            <Popup>
                                                <div style={{ lineHeight: 1.7 }}>
                                                    <strong>Amostra {indice + 1}</strong>

                                                    <div>
                                                        Temperatura estimada:{' '}
                                                        <strong>
                                                            {ponto.temperatura.toFixed(1)
                                                                .replace('.', ',')} °C
                                                        </strong>
                                                    </div>

                                                    <div>
                                                        Latitude: {ponto.latitude.toFixed(5)}
                                                    </div>

                                                    <div>
                                                        Longitude: {ponto.longitude.toFixed(5)}
                                                    </div>

                                                    <div>
                                                        Fonte: Open-Meteo
                                                    </div>
                                                </div>
                                            </Popup>
                                        </CircleMarker>
                                    ))
                                }

                            </>
                        )}

                        {/* ESTAÇÕES CUIDAÍ DO MUNICÍPIO */}
                        {municipio && estacoesDoTerritorio.map(estacao => {
                            const leitura = estacao.ultimaLeitura;

                            const recente =
                                leitura !== null &&
                                instanteAtual >= leitura.recebidoEm &&
                                instanteAtual - leitura.recebidoEm <=
                                30 * 60 * 1000;

                            const selecionada =
                                idEstacaoAtiva === estacao.id;

                            return (
                                <CircleMarker
                                    key={`estacao-cuidai-${estacao.id}`}
                                    center={[
                                        estacao.latitude,
                                        estacao.longitude
                                    ]}
                                    radius={selecionada ? 11 : 8}
                                    pathOptions={{
                                        color: selecionada
                                            ? '#192942'
                                            : '#FFFFFF',
                                        weight: 3,
                                        fillColor: recente
                                            ? '#087CDB'
                                            : '#718399',
                                        fillOpacity: 1
                                    }}
                                    eventHandlers={{
                                        click: () =>
                                            setIdEstacaoSelecionada(atual =>
                                                atual === estacao.id ? null : estacao.id
                                            )
                                    }}
                                >
                                    <Tooltip direction="top">
                                        {estacao.nome} • Estação CUIDAÍ
                                    </Tooltip>

                                    <Popup>
                                        <div style={{ minWidth: '180px' }}>
                                            <strong>{estacao.nome}</strong>

                                            <p>
                                                {recente
                                                    ? 'Leitura recente'
                                                    : 'Sem leitura recente'}
                                            </p>

                                            {leitura ? (
                                                <>
                                                    <div>
                                                        Temperatura:{' '}
                                                        {leitura.temperatura.toFixed(1)} °C
                                                    </div>
                                                    <div>
                                                        Umidade:{' '}
                                                        {leitura.umidade.toFixed(0)}%
                                                    </div>
                                                    <small>
                                                        {new Date(
                                                            leitura.recebidoEm
                                                        ).toLocaleString('pt-BR')}
                                                    </small>
                                                </>
                                            ) : (
                                                <p>Sem medição disponível.</p>
                                            )}
                                        </div>
                                    </Popup>
                                </CircleMarker>
                            );
                        })}

                    </MapContainer>



                    {/* IDENTIFICAÇÃO DO DISTRITO SELECIONADO */}
                    {(municipio?.codigo === '2305654' ||
                        municipio?.codigo === '2304400') && (
                            <div className="atlas-distritos-etiqueta">
                                {erroTerritorial
                                    ? erroTerritorial
                                    : !divisoesAtivas
                                        ? 'Carregando divisões territoriais...'
                                        : geometriaDistritoSelecionado
                                            ? String(
                                                geometriaDistritoSelecionado.properties?.NM_DIST ??
                                                geometriaDistritoSelecionado.properties?.regiao_adm ??
                                                'Área selecionada'
                                            )
                                            : `${divisoesAtivas.features.length} ${municipio?.codigo === '2304400'
                                                ? 'Regionais'
                                                : 'distritos'
                                            } • Clique para selecionar`
                                }

                                {distritoSelecionado && (
                                    <button
                                        type="button"
                                        onClick={() => setDistritoSelecionado(null)}
                                    >
                                        Limpar
                                    </button>
                                )}
                            </div>
                        )}

                    {/* CONTROLE DE VISUALIZAÇÃO DAS AMOSTRAS */}
                    {municipio && (
                        <div className="atlas-amostras-controle">
                            <button
                                type="button"
                                className={
                                    mostrarAmostras
                                        ? 'atlas-amostras-botao atlas-amostras-botao--ativo'
                                        : 'atlas-amostras-botao'
                                }
                                disabled={!perfilMunicipio}
                                aria-pressed={mostrarAmostras}
                                onClick={() =>
                                    setMostrarAmostras(valor => !valor)
                                }
                            >
                                <span className="atlas-amostras-simbolo">
                                    {mostrarAmostras ? '●' : '○'}
                                </span>

                                {perfilMunicipio
                                    ? mostrarAmostras
                                        ? 'Ocultar pontos'
                                        : `Mostrar ${pontosVisiveis.length} pontos`
                                    : erroAmostras
                                        ? 'Amostras indisponíveis'
                                        : 'Preparando amostras...'}
                            </button>

                            {erroAmostras && (
                                <p
                                    role="alert"
                                    style={{
                                        marginTop: 8,
                                        fontSize: 11,
                                        color: '#B42318'
                                    }}
                                >
                                    {erroAmostras}
                                </p>
                            )}

                            {mostrarAmostras && perfilMunicipio && (
                                <div className="atlas-amostras-legenda">
                                    <strong>Temperaturas estimadas</strong>

                                    <div className="atlas-amostras-escala" />

                                    <div className="atlas-amostras-extremos">
                                        <span>
                                            {perfilMunicipio.minima.toFixed(1)
                                                .replace('.', ',')} °C
                                        </span>
                                        <span>
                                            {perfilMunicipio.maxima.toFixed(1)
                                                .replace('.', ',')} °C
                                        </span>
                                    </div>

                                    <small>
                                        Escala relativa aos pontos da área selecionada.
                                        Fonte: Open-Meteo.
                                    </small>
                                </div>
                            )}
                        </div>
                    )}

                </div>

                {/* DASHBOARD ESTATÍSTICO À DIREITA */}
                <aside className="atlas-layout__painel">

                    {municipio &&
                        pontoReferenciaMunicipio &&
                        pontoReferenciaArea &&
                        geometriaMunicipio && (
                            <ObservatorioMunicipal
                                key={`${municipio.codigo}-${distritoSelecionado ?? 'municipio'}`}
                                municipio={municipio.nome}
                                distritoNome={
                                    geometriaDistritoSelecionado
                                        ? String(
                                            geometriaDistritoSelecionado.properties
                                                ?.NM_DIST ??
                                            geometriaDistritoSelecionado.properties?.regiao_adm ??
                                            'Área'
                                        )
                                        : null
                                }
                                uf={estado?.sigla ?? 'CE'}
                                latitude={pontoReferenciaMunicipio.latitude}
                                longitude={pontoReferenciaMunicipio.longitude}
                                latitudeArea={pontoReferenciaArea.latitude}
                                longitudeArea={pontoReferenciaArea.longitude}
                                geometria={
                                    geometriaDistritoSelecionado?.geometry ??
                                    geometriaMunicipio.geometry
                                }
                                onPerfilTermico={receberPerfilTermico}
                                estacoesMunicipais={estacoesDoTerritorio}
                                carregandoEstacoes={carregandoEstacoes}
                                erroEstacoes={erroEstacoes}
                                instanteAtual={instanteAtual}
                                idEstacaoSelecionada={idEstacaoAtiva}
                                onSelecionarEstacao={setIdEstacaoSelecionada}
                                codigoMunicipio={municipio.codigo}
                                municipiosCeara={municipios}
                            />
                        )}

                </aside>

            </div>

            {estaNoCeara && !municipio && legendaRegioes.length > 0 && (
                <div style={{
                    marginTop: '15px', background: '#F4F8FC',
                    border: '1px solid #E1EAF3', borderRadius: '14px', padding: '14px 16px'
                }}>
                    <strong style={{ fontSize: '13px', color: '#214563' }}>
                        Regiões de Planejamento do Ceará
                    </strong>
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                        gap: '9px', marginTop: '12px'
                    }}>
                        {legendaRegioes.map(regiao => (
                            <div key={regiao} style={{
                                display: 'flex', alignItems: 'center',
                                gap: '8px', fontSize: '12px', color: '#42576B'
                            }}>
                                <span style={{
                                    display: 'inline-block', width: '13px', height: '13px',
                                    flexShrink: 0, borderRadius: '4px',
                                    background: CORES_CEARA[chaveRegiao(regiao)] ?? '#D6E4F0'
                                }} />
                                {regiao}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#718096' }}>
                {municipio
                    ? municipio.codigo === '2305654'
                        ? 'Clique em um distrito para destacá-lo. Limites distritais do IBGE, Censo 2022.'
                        : 'Mapa geográfico restrito aos limites municipais. Detalhamento distrital em preparação.'
                    : estaNoCeara
                        ? 'Passe o mouse para identificar o município e sua região; clique para explorar.'
                        : estado
                            ? `${estado.sigla} • A divisão municipal dos demais estados será incorporada nas próximas etapas.`
                            : 'Selecione um estado para explorar o território.'}
            </p>
        </div>
    );
}
