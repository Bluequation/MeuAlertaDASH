import { useEffect, useMemo, useState } from 'react';
import ObservatorioMunicipal from './ObservatorioMunicipal';
import {
    MapContainer,
    GeoJSON,
    TileLayer,
    Polygon,
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

function chaveRegiao(nome: string) {
    return nome
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}


function EnquadramentoAtlas({
    dados,
    estado,
    municipios,
    municipio
}: {
    dados: FeatureCollection;
    estado: EstadoAtlas | null;
    municipios: FeatureCollection | null;
    municipio: MunicipioAtlas | null;
}) {
    const map = useMap();

    useEffect(() => {
        // Identifica qual território precisa ser exibido.
        const geometria = municipio && municipios
            ? municipios.features.find(
                item =>
                    String(item.properties?.id) === municipio.codigo
            )
            : estado
                ? dados.features.find(
                    item =>
                        String(item.properties?.CD_UF) === estado.codigo
                )
                : dados;

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
                    padding: [25, 25],
                    animate: false
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
    }, [map, dados, estado, municipios, municipio]);

    return null;
}



export default function AtlasBrasil() {
    const [dados, setDados] = useState<FeatureCollection | null>(null);
    const [estado, setEstado] = useState<EstadoAtlas | null>(null);
    const [municipios, setMunicipios] = useState<FeatureCollection | null>(null);
    const [municipio, setMunicipio] = useState<MunicipioAtlas | null>(null);
    const [regioesPorMunicipio, setRegioesPorMunicipio] = useState<Record<string, string>>({});
    const [carregandoMunicipios, setCarregandoMunicipios] = useState(false);
    const [erro, setErro] = useState('');

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

    const estiloTerritorio = (feature?: Feature): L.PathOptions => {
        if (municipio) {
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
                                <EnquadramentoAtlas dados={dados} estado={estado}
                                    municipios={municipios} municipio={municipio} />

                                {/* Nível municipal: base geográfica real. */}
                                {municipio && (
                                    <TileLayer
                                        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                                        attribution="&copy; OpenStreetMap contributors"
                                        maxZoom={19}
                                    />
                                )}

                                {/* Apaga o mapa externo, preservando somente o interior municipal. */}
                                {municipio && mascaraExterna && (
                                    <Polygon positions={mascaraExterna} pathOptions={{
                                        stroke: false, fillColor: '#F3F7FB', fillOpacity: 1,
                                        fillRule: 'evenodd', interactive: false
                                    }} />
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
                                                setMunicipio({ codigo, nome });
                                            }
                                        });
                                    }}
                                />
                            </>
                        )}
                    </MapContainer>
                </div>

                {/* DASHBOARD ESTATÍSTICO À DIREITA */}
                <aside className="atlas-layout__painel">
                    {municipio && (
                        <ObservatorioMunicipal
                            municipio={municipio.nome}
                            uf={estado?.sigla ?? 'CE'}
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
                    ? 'Mapa geográfico restrito aos limites municipais. Os distritos internos serão incorporados depois.'
                    : estaNoCeara
                        ? 'Passe o mouse para identificar o município e sua região; clique para explorar.'
                        : estado
                            ? `${estado.sigla} • A divisão municipal dos demais estados será incorporada nas próximas etapas.`
                            : 'Selecione um estado para explorar o território.'}
            </p>
        </div>
    );
}
