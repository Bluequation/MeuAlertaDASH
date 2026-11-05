import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
    estacaoDentroDoMunicipio,
    type EstacaoPublica
} from './estacoesMunicipais';
import BairrosAtlas, {
    identificarBairro
} from './BairrosAtlas';
import {
    FiGrid,
    FiCircle,
    FiThermometer,
    FiActivity,
    FiArrowLeft
} from 'react-icons/fi';
import ObservatorioMunicipal from './ObservatorioMunicipal';
import type { PerfilTermicoMunicipal } from './perfilTermicoMunicipal';
import {
    MapContainer,
    GeoJSON,
    TileLayer,
    Polygon,
    Marker,
    CircleMarker,
    Tooltip,
    Popup,
    useMap
} from 'react-leaflet';
import L from 'leaflet';
import 'leaflet.heat';
import type { Feature, FeatureCollection, Geometry } from 'geojson';

type EstadoAtlas = {
    codigo: string;
    nome: string;
    sigla: string;
};

type MunicipioAtlas = {
    codigo: string;
    nome: string;
};


// CARTOGRAFIA EXPRESSIVA — ESTADOS DO BRASIL
const CORES_ESTADOS: Record<string, string> = {
    AC: '#238CAF',
    AL: '#CA8F3A',
    AP: '#8B6DB7',
    AM: '#4EA485',
    BA: '#E09A42',
    CE: '#547BB6',
    DF: '#D36D78',
    ES: '#A2AA4C',
    GO: '#5F91C5',
    MA: '#C67B55',
    MT: '#53A0A2',
    MS: '#C27C93',
    MG: '#7797B8',
    PA: '#AD84B9',
    PB: '#C98A62',
    PR: '#63A48C',
    PE: '#B97A52',
    PI: '#A7A151',
    RJ: '#4295B2',
    RN: '#9470B2',
    RS: '#6F85B5',
    RO: '#D18B59',
    RR: '#69A99E',
    SC: '#AF7899',
    SE: '#8E9D5E',
    SP: '#83A0BF',
    TO: '#C37876'
};

// CARTOGRAFIA EXPRESSIVA — 14 REGIÕES DO CEARÁ
const CORES_REGIOES_CEARA: Record<string, string> = {
    'cariri': '#8B6DB7',
    'centro sul': '#4EA485',
    'grande fortaleza': '#238CAF',
    'litoral leste': '#D36D78',
    'litoral norte': '#547BB6',
    'litoral oeste vale do curu': '#E09A42',
    'macico de baturite': '#A2AA4C',
    'serra da ibiapaba': '#C67B55',
    'sertao central': '#6384B8',
    'sertao de crateus': '#3B9BAA',
    'sertao dos inhamus': '#CE7565',
    'sertao de caninde': '#9E7EBB',
    'sertao de sobral': '#63A48A',
    'vale do jaguaribe': '#C9A24B'
};

// Escurece uma cor mantendo sua identidade cromática.
function escurecerCor(hex: string, fator = 0.68): string {
    const canais = [1, 3, 5].map(inicio =>
        Math.round(
            parseInt(hex.slice(inicio, inicio + 2), 16) * fator
        ).toString(16).padStart(2, '0')
    );

    return `#${canais.join('')}`;
}


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
// ESCALA TÉRMICA PADRONIZADA DO CUIDAÍ
const TEMPERATURA_MIN_ESCALA = 20;
const TEMPERATURA_MAX_ESCALA = 40;

function corInterpolada(proporcao: number): string {
    const valor = Math.max(0, Math.min(1, proporcao));

    const cores = [
        [35, 153, 215],  // Azul
        [35, 194, 184],  // Turquesa
        [242, 207, 70],  // Amarelo
        [249, 145, 55],  // Laranja
        [216, 68, 67]    // Vermelho
    ];

    const posicao = valor * (cores.length - 1);

    const indice = Math.min(
        Math.floor(posicao),
        cores.length - 2
    );

    const mistura = posicao - indice;

    const canais = cores[indice].map((canal, i) =>
        Math.round(
            canal +
            (cores[indice + 1][i] - canal) * mistura
        )
    );

    return `rgb(${canais.join(',')})`;
}

function corPontoTermicoAbsoluta(
    temperatura: number
): string {
    const proporcao = (
        temperatura - TEMPERATURA_MIN_ESCALA
    ) / (
            TEMPERATURA_MAX_ESCALA - TEMPERATURA_MIN_ESCALA
        );

    return corInterpolada(proporcao);
}

function obterFaixaContrasteTermico(
    media: number,
    minima: number,
    maxima: number
): number {
    const amplitude = Math.max(
        media - minima,
        maxima - media,
        0.6
    );

    return Math.min(
        2.2,
        Math.max(0.6, amplitude * 1.15)
    );
}

function corPontoTermicoContraste(
    temperatura: number,
    media: number,
    minima: number,
    maxima: number
): string {
    // Mede o quanto a temperatura se afasta da média da área.
    const faixa = obterFaixaContrasteTermico(
        media,
        minima,
        maxima
    );

    const proporcao = (
        temperatura - (media - faixa)
    ) / (faixa * 2);

    return corInterpolada(proporcao);
}

type EscalaTermica = 'contraste' | 'absoluta';

// MALHA TÉRMICA PONTILHADA — CUIDAÍ
function MalhaTermicaPontilhada({
    geometria,
    pontos,
    minima,
    maxima,
    modoEscala,
    modoInspecao,
    onSelecionar,
    focoInspecionado,
    quenturaEmDestaque
}: {
    geometria: Geometry;
    pontos: PerfilTermicoMunicipal['pontos'];
    minima: number;
    maxima: number;
    modoEscala: EscalaTermica;
    modoInspecao: boolean;
    onSelecionar: (ponto: PontoInspecionado | null) => void;
    focoInspecionado: PontoInspecionado | null;
    quenturaEmDestaque: boolean;
}) {
    const map = useMap();

    useEffect(() => {
        if (
            pontos.length === 0 ||
            (
                geometria.type !== 'Polygon' &&
                geometria.type !== 'MultiPolygon'
            )
        ) return;

        const mediaArea =
            pontos.reduce(
                (acumulado, ponto) =>
                    acumulado + ponto.temperatura,
                0
            ) / pontos.length;

        // Pane independente: acima do mapa-base,
        // abaixo dos limites e marcadores.
        const pane = map.getPane('cuidaiMalhaTermica')
            ?? map.createPane('cuidaiMalhaTermica');

        pane.style.zIndex = '350';
        pane.style.pointerEvents = 'none';

        const canvas = document.createElement('canvas');
        canvas.style.position = 'absolute';
        canvas.style.pointerEvents = 'none';
        canvas.setAttribute('aria-hidden', 'true');

        pane.appendChild(canvas);

        const contexto = canvas.getContext('2d');
        if (!contexto) {
            canvas.remove();
            return;
        }

        const espacamento = 14;
        const raio = 3.6;

        let quadro = 0;

        const focoSelecionado = focoInspecionado
            ? L.latLng(
                focoInspecionado.latitude,
                focoInspecionado.longitude
            )
            : null;

        let estimarTemperaturaAtual:
            ((x: number, y: number) => number) | null = null;


        const desenhar = () => {
            const tamanho = map.getSize();

            if (tamanho.x <= 0 || tamanho.y <= 0) return;

            const largura = tamanho.x;
            const altura = tamanho.y;
            const escala = Math.min(
                window.devicePixelRatio || 1,
                2
            );

            canvas.width = Math.round(largura * escala);
            canvas.height = Math.round(altura * escala);

            canvas.style.width = `${largura}px`;
            canvas.style.height = `${altura}px`;

            // Alinha a camada ao mapa Leaflet.
            L.DomUtil.setPosition(
                canvas,
                map.containerPointToLayerPoint([0, 0])
            );

            contexto.setTransform(
                escala, 0, 0, escala, 0, 0
            );

            contexto.clearRect(
                0, 0, largura, altura
            );

            // Constrói o contorno geográfico.
            const poligonos = geometria.type === 'Polygon'
                ? [geometria.coordinates]
                : geometria.coordinates;

            contexto.beginPath();

            for (const poligono of poligonos) {
                for (const anel of poligono) {
                    anel.forEach(([longitude, latitude], indice) => {
                        const posicao = map.latLngToContainerPoint(
                            [latitude, longitude]
                        );

                        if (indice === 0) {
                            contexto.moveTo(
                                posicao.x,
                                posicao.y
                            );
                        } else {
                            contexto.lineTo(
                                posicao.x,
                                posicao.y
                            );
                        }
                    });

                    contexto.closePath();
                }
            }

            contexto.save();
            contexto.clip('evenodd');

            // Projeta as amostras meteorológicas existentes.
            const amostrasProjetadas = pontos.map(ponto => {
                const posicao = map.latLngToContainerPoint(
                    [ponto.latitude, ponto.longitude]
                );

                return {
                    x: posicao.x,
                    y: posicao.y,
                    temperatura: ponto.temperatura
                };
            });

            // Interpolação espacial por distância inversa.
            const estimarTemperatura = (x: number, y: number) => {
                let somaPonderada = 0;
                let somaPesos = 0;

                for (const amostra of amostrasProjetadas) {
                    const dx = x - amostra.x;
                    const dy = y - amostra.y;

                    const distanciaQuadrada =
                        dx * dx + dy * dy;

                    if (distanciaQuadrada < 1) {
                        return amostra.temperatura;
                    }

                    const peso = 1 / Math.max(
                        distanciaQuadrada,
                        36
                    );

                    somaPonderada +=
                        amostra.temperatura * peso;

                    somaPesos += peso;
                }

                return somaPonderada / somaPesos;
            };

            estimarTemperaturaAtual = estimarTemperatura;

            // Malha regular ancorada nas coordenadas do mapa.
            const limitesPixels = map.getPixelBounds();
            const origemPixels = limitesPixels.min;

            if (!origemPixels) {
                contexto.restore();
                return;
            }

            const inicioX =
                Math.ceil(origemPixels.x / espacamento) *
                espacamento - origemPixels.x;

            const inicioY =
                Math.ceil(origemPixels.y / espacamento) *
                espacamento - origemPixels.y;

            contexto.globalAlpha = 1;

            for (
                let y = inicioY;
                y < altura;
                y += espacamento
            ) {
                for (
                    let x = inicioX;
                    x < largura;
                    x += espacamento
                ) {
                    const temperatura =
                        estimarTemperatura(x, y);

                    const centroFoco = focoSelecionado
                        ? map.latLngToContainerPoint(focoSelecionado)
                        : null;

                    const distanciaFoco = centroFoco
                        ? Math.hypot(
                            x - centroFoco.x,
                            y - centroFoco.y
                        )
                        : Infinity;

                    // Influência visual até 105 pixels do ponto escolhido.
                    const influencia = centroFoco
                        ? Math.max(0, 1 - distanciaFoco / 105)
                        : 0;


                    const raioAtual = centroFoco
                        ? 2.4 + 6.2 * influencia
                        : raio;

                    contexto.globalAlpha = quenturaEmDestaque
                        ? centroFoco
                            ? 0.14 + 0.28 * influencia
                            : 0.23
                        : centroFoco
                            ? 0.18 + 0.82 * influencia
                            : 1;

                    const cor =
                        modoEscala === 'contraste'
                            ? corPontoTermicoContraste(
                                temperatura,
                                mediaArea,
                                minima,
                                maxima
                            )
                            : corPontoTermicoAbsoluta(
                                temperatura
                            );

                    contexto.fillStyle = quenturaEmDestaque
                        ? '#9AA8B5'
                        : cor;

                    contexto.beginPath();
                    contexto.arc(
                        x,
                        y,
                        raioAtual,
                        0,
                        Math.PI * 2
                    );
                    contexto.fill();

                    // Borda discreta, sem brilho ou sombra.
                    contexto.strokeStyle = 'rgba(25, 41, 66, 0.22)';
                    contexto.lineWidth = 0.6;
                    contexto.stroke();
                }
            }



            contexto.globalAlpha = 1;
            contexto.restore();
        };

        const agendarDesenho = () => {
            cancelAnimationFrame(quadro);
            quadro = requestAnimationFrame(desenhar);
        };

        // LOCALIZA A BOLINHA MAIS PRÓXIMA DO CURSOR OU TOQUE
        const localizarBolinha = (
            evento: L.LeafletMouseEvent,
            tolerancia: number
        ) => {
            const origem = map.getPixelBounds().min;

            if (!origem || !estimarTemperaturaAtual) {
                return null;
            }

            const x =
                Math.round(
                    (evento.containerPoint.x + origem.x) /
                    espacamento
                ) * espacamento - origem.x;

            const y =
                Math.round(
                    (evento.containerPoint.y + origem.y) /
                    espacamento
                ) * espacamento - origem.y;

            if (
                Math.hypot(
                    x - evento.containerPoint.x,
                    y - evento.containerPoint.y
                ) > tolerancia
            ) {
                return null;
            }

            const local = map.containerPointToLatLng([x, y]);

            if (
                !estacaoDentroDoMunicipio(
                    geometria,
                    local.lat,
                    local.lng
                )
            ) {
                return null;
            }

            const temperatura = estimarTemperaturaAtual(x, y);

            if (!Number.isFinite(temperatura)) return null;

            return {
                local,
                temperatura
            };
        };

        // TOOLTIP PARA COMPUTADOR
        const tooltipTemperatura = L.tooltip({
            direction: 'top',
            offset: [0, -10],
            opacity: 1,
            interactive: false,
            className: 'atlas-tooltip-termico'
        });

        const informarTemperatura = (
            evento: L.LeafletMouseEvent
        ) => {

            // Com um ponto selecionado, não exibir a etiqueta flutuante.
            if (focoInspecionado !== null) {
                map.closeTooltip(tooltipTemperatura);
                return;
            }
            // Mostra informação ao passar o mouse sobre uma bolinha.
            const ponto = localizarBolinha(evento, 5);

            if (!ponto) {
                map.closeTooltip(tooltipTemperatura);
                return;
            }

            tooltipTemperatura
                .setLatLng(ponto.local)
                .setContent(
                    `${ponto.temperatura.toFixed(1).replace('.', ',')} °C`
                );

            map.openTooltip(tooltipTemperatura);
        };

        // CLIQUE OU TOQUE PARA INSPECIONAR E DESTACAR
        const selecionarPontoTermico = (
            evento: L.LeafletMouseEvent
        ) => {
            const ponto = localizarBolinha(evento, 10);

            if (!ponto) {
                onSelecionar(null);
                return;
            }

            onSelecionar({
                latitude: ponto.local.lat,
                longitude: ponto.local.lng,
                temperatura: ponto.temperatura
            });

            map.closeTooltip(tooltipTemperatura);
        };

        const ocultarTooltip = () => {
            map.closeTooltip(tooltipTemperatura);
        };

        map.on('mousemove', informarTemperatura);
        map.on('mouseout', ocultarTooltip);
        map.on('click', selecionarPontoTermico);

        map.on(
            'moveend zoomend resize',
            agendarDesenho
        );

        const observador = new ResizeObserver(
            agendarDesenho
        );

        observador.observe(map.getContainer());

        agendarDesenho();

        return () => {
            cancelAnimationFrame(quadro);
            observador.disconnect();

            map.off(
                'moveend zoomend resize',
                agendarDesenho
            );

            canvas.remove();

            map.off('mousemove', informarTemperatura);
            map.off('mouseout', ocultarTooltip);
            map.off('click', selecionarPontoTermico);

            map.closeTooltip(tooltipTemperatura);
        };
    }, [
        map,
        geometria,
        pontos,
        minima,
        maxima,
        modoEscala,
        modoInspecao,
        onSelecionar,
        focoInspecionado,
        quenturaEmDestaque
    ]);

    return null;
}

// LIMPA A SELEÇÃO AO CLICAR NUMA ÁREA VAZIA DO MAPA
function LimparDestaqueTerritorialNoMapa({
    ativo,
    aoLimpar
}: {
    ativo: boolean;
    aoLimpar: () => void;
}) {
    const map = useMap();

    useEffect(() => {
        if (!ativo) return;

        const tratarClique = (
            evento: L.LeafletMouseEvent
        ) => {
            const alvo = evento.originalEvent.target;

            // Não limpa quando o clique foi em um polígono.
            if (
                alvo instanceof Element &&
                alvo.closest('.leaflet-interactive')
            ) {
                return;
            }

            aoLimpar();
        };

        map.on('click', tratarClique);

        return () => {
            map.off('click', tratarClique);
        };
    }, [map, ativo, aoLimpar]);

    return null;
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
        const distritoAtual = distritos?.features.find(
            item =>
                String(
                    item.properties?.CD_DIST ??
                    item.properties?.id ??
                    ''
                ) === distritoSelecionado
        );

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

        const ajustar = () => {
            cancelAnimationFrame(quadro);

            quadro = requestAnimationFrame(() => {
                // Interrompe qualquer animação anterior.
                map.stop();

                map.invalidateSize({
                    pan: false,
                    animate: false
                });

                // Enquadramento imediato, sem zoom animado.
                map.fitBounds(limites, {
                    padding: [28, 28],
                    maxZoom: distritoAtual ? 13 : undefined,
                    animate: false
                });
            });
        };

        const observador = new ResizeObserver(ajustar);
        observador.observe(map.getContainer());

        ajustar();

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

type RelatoQuenturaAtlas = {
    id: string;
    latitude: number;
    longitude: number;
    titulo: string;
    detalhe?: string;
    hora?: string;
};

// CUIDAÍ — CONCENTRAÇÃO COMUNITÁRIA DE QUENTURA
function CamadaConcentracaoQuentura({
    relatos
}: {
    relatos: RelatoQuenturaAtlas[];
}) {
    const map = useMap();

    useEffect(() => {
        if (relatos.length < 2) return;

        // Camada acima da malha térmica,
        // mas abaixo dos contornos territoriais.
        const nomePane = 'cuidaiConcentracaoQuentura';

        const pane = map.getPane(nomePane)
            ?? map.createPane(nomePane);

        pane.style.zIndex = '370';
        pane.style.pointerEvents = 'none';
        pane.style.opacity = '0.78';

        const pontos: [number, number, number][] =
            relatos.map(relato => [
                relato.latitude,
                relato.longitude,
                0.75
            ]);

        const opcoesCamada = {
            pane: nomePane,
            radius: 38,
            blur: 22,
            maxZoom: 15,
            max: 1.5,
            minOpacity: 0.12,
            gradient: {
                0.2: '#F7C58E',
                0.45: '#F4A261',
                0.7: '#DC7147',
                1.0: '#AD4038'
            }
        };

        const camada = L.heatLayer(pontos, opcoesCamada);

        camada.addTo(map);

        return () => {
            map.removeLayer(camada);
        };
    }, [map, relatos]);

    return null;
}

// MARCADOR DE RELATO COMUNITÁRIO DE QUENTURA
const ICONE_QUENTURA = L.divIcon({
    className: 'atlas-relato-quentura',
    html: `
        <span class="atlas-relato-quentura__halo"></span>
        <span class="atlas-relato-quentura__centro">
            <svg
                width="19"
                height="19"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                stroke-width="2"
                stroke-linecap="round"
                stroke-linejoin="round"
                aria-hidden="true"
            >
                <path d="M12 22c4 0 7-3 7-7 0-3-2-6-4-8 0 2-1 3-3 4 0-4-2-7-4-9 0 4-1 6-3 9-1 2-1 3-1 4 0 4 3 7 8 7Z"/>
            </svg>
        </span>
    `,
    iconSize: [42, 42],
    iconAnchor: [21, 21],
    popupAnchor: [0, -22]
});

type PropsAtlas = {
    estacoes: EstacaoPublica[];
    carregandoEstacoes: boolean;
    erroEstacoes: string | null;
    instanteAtual: number;
    alertasQuentura: RelatoQuenturaAtlas[];
};

type PontoInspecionado = {
    latitude: number;
    longitude: number;
    temperatura: number;
};

function interpretarTemperatura(diferenca: number): string {
    if (diferenca >= 0.7) {
        return 'O modelo indica uma temperatura relativamente acima da média desta área.';
    }

    if (diferenca <= -0.7) {
        return 'O modelo indica uma temperatura relativamente abaixo da média desta área.';
    }

    return 'A temperatura estimada está próxima da média desta área.';
}

export default function AtlasBrasil({
    estacoes,
    carregandoEstacoes,
    erroEstacoes,
    instanteAtual,
    alertasQuentura
}: PropsAtlas) {
    const [dados, setDados] = useState<FeatureCollection | null>(null);

    const [pontoInspecionado, setPontoInspecionado] =
        useState<PontoInspecionado | null>(null);

    const selecionarInspecao = useCallback(
        (ponto: PontoInspecionado | null) => {
            setPontoInspecionado(ponto);
        },
        []
    );

    const referenciaMapa = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const fecharAoTocarFora = (evento: PointerEvent) => {
            const alvo = evento.target;

            if (
                alvo instanceof Node &&
                referenciaMapa.current &&
                !referenciaMapa.current.contains(alvo)
            ) {
                setPontoInspecionado(null);
            }
        };

        document.addEventListener(
            'pointerdown',
            fecharAoTocarFora
        );

        return () => {
            document.removeEventListener(
                'pointerdown',
                fecharAoTocarFora
            );
        };
    }, []);

    const [bairrosFortaleza, setBairrosFortaleza] =
        useState<FeatureCollection | null>(null);

    const [bairrosIpaporanga, setBairrosIpaporanga] =
        useState<FeatureCollection | null>(null);


    const [estado, setEstado] = useState<EstadoAtlas | null>(null);
    const [municipios, setMunicipios] = useState<FeatureCollection | null>(null);
    const [municipio, setMunicipio] = useState<MunicipioAtlas | null>(null);
    useEffect(() => {
        if (
            municipio?.codigo !== '2304400' ||
            bairrosFortaleza
        ) return;

        const controlador = new AbortController();

        fetch('/dados/bairros_fortaleza.geojson', {
            signal: controlador.signal
        })
            .then(resposta => {
                if (!resposta.ok) {
                    throw new Error('Arquivo de bairros indisponível');
                }
                return resposta.json();
            })
            .then((dados: FeatureCollection) => {
                if (
                    dados.type === 'FeatureCollection' &&
                    Array.isArray(dados.features)
                ) {
                    setBairrosFortaleza(dados);
                }
            })
            .catch(erro => {
                if (!controlador.signal.aborted) {
                    console.warn('Bairros de Fortaleza:', erro);
                }
            });

        return () => controlador.abort();
    }, [municipio?.codigo, bairrosFortaleza]);

    // CARREGAMENTO DOS BAIRROS DE IPAPORANGA — IBGE 2022
    useEffect(() => {
        if (
            municipio?.codigo !== '2305654' ||
            bairrosIpaporanga
        ) return;

        const controlador = new AbortController();

        fetch('/dados/bairros_ipaporanga.geojson', {
            signal: controlador.signal
        })
            .then(resposta => {
                if (!resposta.ok) {
                    throw new Error('Malha de bairros indisponível');
                }
                return resposta.json();
            })
            .then((dados: FeatureCollection) => {
                if (
                    !controlador.signal.aborted &&
                    dados.type === 'FeatureCollection' &&
                    Array.isArray(dados.features) &&
                    dados.features.length > 0
                ) {
                    setBairrosIpaporanga(dados);
                }
            })
            .catch(erro => {
                if (!controlador.signal.aborted) {
                    console.warn('Bairros de Ipaporanga:', erro);
                }
            });

        return () => controlador.abort();
    }, [municipio?.codigo, bairrosIpaporanga]);

    // DISSOLVÊNCIA SUAVE DO ATLAS
    const [mapaOculto, setMapaOculto] = useState(false);

    const transicaoEmCurso = useRef(false);
    const temporizadoresMapa = useRef<number[]>([]);

    // Referência à camada que desenha Brasil e Ceará.
    const mapaTerritorialGeoJSONRef = useRef<L.GeoJSON | null>(null);
    // Primeiro toque destaca; segundo toque no mesmo território navega.
    const toqueTerritorioPendente = useRef<string | null>(null);

    useEffect(() => {
        return () => {
            temporizadoresMapa.current.forEach(
                temporizador => window.clearTimeout(temporizador)
            );
        };
    }, []);

    const navegarComFade = (acao: () => void) => {
        if (transicaoEmCurso.current) return;

        transicaoEmCurso.current = true;

        // 110 ms — desaparecimento
        setMapaOculto(true);

        const primeiro = window.setTimeout(() => {
            // Troca o território enquanto o mapa está oculto.
            acao();

            // 30 ms — permite atualizar o enquadramento.
            const segundo = window.setTimeout(() => {
                // 110 ms — reaparecimento
                setMapaOculto(false);

                const terceiro = window.setTimeout(() => {
                    transicaoEmCurso.current = false;
                    temporizadoresMapa.current = [];
                }, 110);

                temporizadoresMapa.current.push(terceiro);
            }, 30);

            temporizadoresMapa.current.push(segundo);
        }, 110);

        temporizadoresMapa.current.push(primeiro);
    };

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

    const [modoVisualizacaoTermica, setModoVisualizacaoTermica] =
        useState<'malha' | 'amostras'>('malha');

    type EscalaTermica = 'contraste' | 'absoluta';

    const [escalaTermica, setEscalaTermica] =
        useState<EscalaTermica>('contraste');

    const inspecaoTermica = true;

    const inspecaoTermicaRef = useRef(false);

    useEffect(() => {
        inspecaoTermicaRef.current =
            inspecaoTermica &&
            mostrarAmostras &&
            modoVisualizacaoTermica === 'malha';
    }, [
        inspecaoTermica,
        mostrarAmostras,
        modoVisualizacaoTermica
    ]);

    const [mostrarRelatosQuentura, setMostrarRelatosQuentura] =
        useState(false);

    const [
        mostrarConcentracaoQuentura,
        setMostrarConcentracaoQuentura
    ] = useState(false);

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

    // BAIRROS DISPONÍVEIS DO MUNICÍPIO SELECIONADO
    const bairrosDoMunicipio =
        municipio?.codigo === '2304400'
            ? bairrosFortaleza
            : municipio?.codigo === '2305654'
                ? bairrosIpaporanga
                : null;

    // IDENTIFICA O TERRITÓRIO DO PONTO INSPECIONADO
    const nomeTerritorioInspecionado = useMemo(() => {
        if (!pontoInspecionado || !municipio) return null;

        const { latitude, longitude } = pontoInspecionado;

        // Fortaleza: prefere o bairro, quando disponível.
        if (
            municipio.codigo === '2304400' ||
            municipio.codigo === '2305654'
        ) {
            const bairro = identificarBairro(
                bairrosDoMunicipio,
                latitude,
                longitude
            );

            if (bairro) return `Bairro ${bairro}`;
        }

        // Identifica distrito ou Regional pelos limites existentes.
        const divisao = divisoesAtivas?.features.find(
            feature =>
                feature.geometry &&
                estacaoDentroDoMunicipio(
                    feature.geometry,
                    latitude,
                    longitude
                )
        );

        if (divisao) {
            const nome = String(
                divisao.properties?.NM_DIST ??
                divisao.properties?.regiao_adm ??
                ''
            ).trim();

            if (nome) {
                return municipio.codigo === '2304400'
                    ? nome
                    : `Distrito de ${nome}`;
            }
        }

        return `Área de ${municipio.nome}`;
    }, [
        pontoInspecionado,
        municipio,
        bairrosDoMunicipio,
        divisoesAtivas
    ]);



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

    // RELATOS DE QUENTURA DENTRO DA ÁREA SELECIONADA
    const relatosQuenturaDoTerritorio = useMemo(() => {
        const geometria =
            geometriaDistritoSelecionado?.geometry ??
            geometriaMunicipio?.geometry;

        if (!geometria) return [];

        return alertasQuentura.filter(relato =>
            estacaoDentroDoMunicipio(
                geometria,
                relato.latitude,
                relato.longitude
            )
        );

    }, [
        alertasQuentura,
        geometriaDistritoSelecionado,
        geometriaMunicipio
    ]);

    // PROXIMIDADE ENTRE RELATOS COMUNITÁRIOS
    const RAIO_CONCENTRACAO_METROS = 1200;

    const relatosEmConcentracao = useMemo(() => {
        const validos = relatosQuenturaDoTerritorio.filter(
            relato =>
                Number.isFinite(relato.latitude) &&
                Number.isFinite(relato.longitude)
        );

        if (validos.length < 2) return [];

        const coordenadas = validos.map(relato =>
            L.latLng(relato.latitude, relato.longitude)
        );

        const indicesProximos = new Set<number>();

        for (let i = 0; i < validos.length; i++) {
            for (let j = i + 1; j < validos.length; j++) {
                const distancia = coordenadas[i].distanceTo(
                    coordenadas[j]
                );

                if (distancia <= RAIO_CONCENTRACAO_METROS) {
                    indicesProximos.add(i);
                    indicesProximos.add(j);
                }
            }
        }

        return validos.filter(
            (_, indice) => indicesProximos.has(indice)
        );

    }, [relatosQuenturaDoTerritorio]);
    // Dá prioridade visual aos relatos comunitários.
    const quenturaEmDestaque =
        (
            mostrarRelatosQuentura &&
            relatosQuenturaDoTerritorio.length > 0
        ) || (
            mostrarConcentracaoQuentura &&
            relatosEmConcentracao.length >= 2
        );

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

    const faixaContrasteLegenda = perfilMunicipio
        ? obterFaixaContrasteTermico(
            perfilMunicipio.media,
            perfilMunicipio.minima,
            perfilMunicipio.maxima
        )
        : 0.6;
    // CARTO — BASE SEM RÓTULOS PARA O MODO ANALÍTICO
    const chaveCarto = String(
        import.meta.env.VITE_CARTOKE_KEY ?? ''
    ).trim();

    const usarMapaSemRotulos =
        Boolean(municipio) &&
        mostrarAmostras &&
        modoVisualizacaoTermica === 'malha' &&
        chaveCarto.length > 0;

    const estiloTerritorio = (_feature?: Feature): L.PathOptions => {
        // MUNICÍPIO: preserva os limites distritais existentes.
        if (municipio) {
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

        // CEARÁ — aparência neutra antes da interação
        if (estaNoCeara && municipios) {
            return {
                color: '#FFFFFF',
                weight: 0.9,
                opacity: 1,
                fillColor: '#E3EBF2',
                fillOpacity: 1
            };
        }

        // Estado selecionado enquanto seus municípios carregam.
        if (estado) {
            return {
                color: '#087CDB',
                weight: 2.4,
                fillColor: '#D6E4F0',
                fillOpacity: 1
            };
        }

        // BRASIL — aparência neutra antes da interação
        return {
            color: '#FFFFFF',
            weight: 1.1,
            opacity: 1,
            fillColor: '#E3EBF2',
            fillOpacity: 1
        };
    };

    // CUIDAÍ — DESTAQUE INTERATIVO DAS REGIÕES DO CEARÁ
    // DESTAQUE INTERATIVO — BRASIL E CEARÁ
    const destacarTerritorio = (codigoEmFoco: string | null) => {
        const camada = mapaTerritorialGeoJSONRef.current;

        if (!camada) return;

        const nivelCeara = estaNoCeara && municipios !== null;

        const regiaoEmFoco = nivelCeara && codigoEmFoco
            ? chaveRegiao(
                regioesPorMunicipio[codigoEmFoco] ?? ''
            )
            : '';

        camada.eachLayer(elemento => {
            const poligono = elemento as L.Path & {
                feature?: Feature;
            };

            const feature = poligono.feature;

            if (
                !feature ||
                typeof poligono.setStyle !== 'function'
            ) return;

            // Quando não há seleção, recupera a paleta original.
            if (!codigoEmFoco) {
                poligono.setStyle(estiloTerritorio(feature));
                return;
            }

            if (nivelCeara) {
                const codigo = String(
                    feature.properties?.id ?? ''
                );

                const regiao = chaveRegiao(
                    regioesPorMunicipio[codigo] ?? ''
                );

                const corBase =
                    CORES_REGIOES_CEARA[regiao] ?? '#92A8B8';

                const mesmaRegiao =
                    regiaoEmFoco !== '' &&
                    regiao === regiaoEmFoco;

                const emFoco = codigo === codigoEmFoco;

                poligono.setStyle({
                    color: emFoco
                        ? escurecerCor(corBase, 0.55)
                        : '#FFFFFF',

                    weight: emFoco ? 2.4 : 0.9,
                    opacity: 1,

                    fillColor: emFoco
                        ? escurecerCor(corBase, 0.70)
                        : mesmaRegiao
                            ? corBase
                            : '#E3EBF2',

                    fillOpacity: emFoco
                        ? 1
                        : mesmaRegiao
                            ? 0.75
                            : 1
                });

                if (emFoco) {
                    poligono.bringToFront();
                }

                return;
            }

            // Brasil: destaque individual do estado.
            const codigo = String(
                feature.properties?.CD_UF ?? ''
            );

            const sigla = String(
                feature.properties?.SIGLA_UF ?? ''
            );

            const corBase =
                CORES_ESTADOS[sigla] ?? '#92A8B8';

            const emFoco = codigo === codigoEmFoco;

            poligono.setStyle({
                color: emFoco
                    ? escurecerCor(corBase, 0.55)
                    : '#FFFFFF',

                weight: emFoco ? 2.4 : 1.1,
                opacity: 1,

                fillColor: emFoco
                    ? corBase
                    : '#E3EBF2',

                fillOpacity: 1
            });

            if (emFoco) poligono.bringToFront();
        });
    };

    const nomeRegiaoSelecionada = municipio
        ? regioesPorMunicipio[municipio.codigo]
        : null;


    return (
        <div className="atlas-cuidai" style={{ width: '100%' }}>
            <div
                className="atlas-cabecalho"
                style={{
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
                    className="atlas-layout__coluna-mapa"
                    style={{
                        display: 'flex',
                        flexDirection: 'column',
                        gap: '8px',
                        minWidth: 0
                    }}
                >

                    <div
                        ref={referenciaMapa}
                        className={[
                            'atlas-layout__mapa',
                            mapaOculto ? 'atlas-layout__mapa--oculto' : '',
                            municipio &&
                                mostrarAmostras &&
                                modoVisualizacaoTermica === 'malha'
                                ? 'atlas-layout__mapa--termica'
                                : '',
                            usarMapaSemRotulos
                                ? 'atlas-layout__mapa--sem-rotulos'
                                : ''
                        ].filter(Boolean).join(' ')}
                        style={{
                            order: 2,
                            height: municipio
                                ? 'clamp(340px, 44vh, 440px)'
                                : 'min(75vh, 650px)',
                            minHeight: municipio ? '340px' : '480px',
                            width: '100%',
                            borderRadius: '14px',
                            overflow: 'hidden',
                            background: '#F3F7FB'
                        }}
                    >

                        {/* NAVEGAÇÃO DO ATLAS — VOLTAR */}
                        {estado && (
                            <button
                                type="button"
                                className="atlas-mapa-voltar"
                                title={municipio ? 'Voltar ao Ceará' : 'Voltar ao Brasil'}
                                onClick={() => {
                                    navegarComFade(() => {
                                        setPontoInspecionado(null);
                                        setMostrarAmostras(false);

                                        if (municipio) {
                                            setMunicipio(null);
                                        } else {
                                            setEstado(null);
                                        }
                                    });
                                }}
                            >
                                <FiArrowLeft size={15} />
                                <span>
                                    {municipio ? 'Ceará' : 'Brasil'}
                                </span>
                            </button>
                        )}

                        <MapContainer
                            center={[-14.5, -52]}
                            zoom={4}
                            zoomSnap={0}
                            zoomAnimationThreshold={12}
                            zoomControl={false}
                            scrollWheelZoom={false}
                            doubleClickZoom={false}
                            style={{ width: '100%', height: '100%', background: '#F3F7FB' }}>

                            <LimparDestaqueTerritorialNoMapa
                                ativo={!municipio}
                                aoLimpar={() => {
                                    toqueTerritorioPendente.current = null;
                                    destacarTerritorio(null);
                                }}
                            />


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
                                    {/* BASE CARTOGRÁFICA — NAVEGAÇÃO / ANÁLISE */}
                                    {municipio && (
                                        <TileLayer
                                            key={
                                                usarMapaSemRotulos
                                                    ? 'carto-sem-rotulos'
                                                    : 'osm-navegacao'
                                            }
                                            url={
                                                usarMapaSemRotulos
                                                    ? `https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}.png?key=${encodeURIComponent(chaveCarto)}`
                                                    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
                                            }
                                            subdomains={usarMapaSemRotulos ? 'abcd' : 'abc'}
                                            attribution={
                                                usarMapaSemRotulos
                                                    ? '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, &copy; <a href="https://carto.com/attributions">CARTO</a>'
                                                    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                                            }
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
                                        ref={mapaTerritorialGeoJSONRef}
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
                                            const codigo = estaNoCeara && municipios
                                                ? String(feature.properties?.id ?? '')
                                                : String(feature.properties?.CD_UF ?? '');
                                            const regiao = regioesPorMunicipio[codigo];
                                            const etiqueta = estaNoCeara && regiao
                                                ? `${nome} • ${regiao}` : nome;
                                            if (etiqueta) layer.bindTooltip(etiqueta, {
                                                sticky: true, direction: 'top'
                                            });
                                            // PASSAR O CURSOR: ESTADO OU REGIÃO DE PLANEJAMENTO
                                            // CURSOR: DESTACA SEM NAVEGAR
                                            layer.on('mouseover', () => {
                                                // Em telas de toque, só o toque define a seleção.
                                                if (window.matchMedia('(hover: none)').matches) {
                                                    return;
                                                }

                                                destacarTerritorio(codigo);
                                            });

                                            // SAÍDA DO CURSOR: RECUPERA O ESTADO NORMAL
                                            layer.on('mouseout', () => {
                                                if (window.matchMedia('(hover: none)').matches) {
                                                    return;
                                                }

                                                destacarTerritorio(null);
                                            });

                                            // CLIQUE / TOQUE: COMPORTAMENTOS DIFERENTES
                                            layer.on('click', (evento: L.LeafletMouseEvent) => {
                                                const dispositivoDeToque = window.matchMedia(
                                                    '(hover: none) and (pointer: coarse)'
                                                ).matches;

                                                if (dispositivoDeToque) {
                                                    L.DomEvent.stopPropagation(evento.originalEvent);

                                                    // Primeiro toque ou toque em outro território.
                                                    if (toqueTerritorioPendente.current !== codigo) {
                                                        toqueTerritorioPendente.current = codigo;

                                                        destacarTerritorio(codigo);

                                                        // Exibe o nome e, no Ceará, a região.
                                                        layer.openTooltip(evento.latlng);
                                                        return;
                                                    }
                                                }

                                                // Clique no computador ou segundo toque no tablet.
                                                toqueTerritorioPendente.current = null;

                                                navegarComFade(() => {
                                                    if (!estado) {
                                                        setEstado({
                                                            codigo: String(
                                                                feature.properties?.CD_UF ?? ''
                                                            ),
                                                            nome: String(
                                                                feature.properties?.NM_UF ?? ''
                                                            ),
                                                            sigla: String(
                                                                feature.properties?.SIGLA_UF ?? ''
                                                            )
                                                        });
                                                    } else if (estaNoCeara && municipios) {
                                                        if (!codigo) return;

                                                        setMostrarAmostras(false);
                                                        setPerfilMapa(null);
                                                        setMunicipio({ codigo, nome });
                                                    }
                                                });
                                            });
                                        }}
                                    />

                                    {/* A seleção distrital é controlada pela camada abaixo. */}
                                    {/* LIMITES INTERATIVOS DOS DISTRITOS DE IPAPORANGA */}
                                    {
                                        divisoesAtivas && (
                                            <GeoJSON
                                                key={`divisoes-${municipio?.codigo}-${distritoSelecionado ?? 'todos'}-${bairrosDoMunicipio ? 'bairros' : 'divisoes'}-${mostrarAmostras && modoVisualizacaoTermica === 'malha' ? 'inspecao' : 'navegacao'}`}
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

                                                    if (
                                                        !bairrosDoMunicipio &&
                                                        !(mostrarAmostras && modoVisualizacaoTermica === 'malha')
                                                    ) {
                                                        layer.bindTooltip(nome, {
                                                            sticky: true,
                                                            direction: 'top',
                                                            className: 'atlas-tooltip-territorio'
                                                        });
                                                    }

                                                    // COLORIR AO PASSAR O MOUSE
                                                    layer.on('mouseover', () => {

                                                        // Durante a inspeção térmica, não pinta a Regional.
                                                        if (inspecaoTermicaRef.current) {
                                                            camada.setStyle({
                                                                color: '#66A7D3',
                                                                weight: 1.5,
                                                                fillColor: '#FFFFFF',
                                                                fillOpacity: 0.01
                                                            });

                                                            layer.closeTooltip();
                                                            return;
                                                        }

                                                        // Fora da inspeção, mantém o destaque territorial.
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

                                                    layer.on('click', () => {
                                                        // Impede a seleção territorial durante a inspeção térmica.
                                                        if (inspecaoTermicaRef.current) return;

                                                        navegarComFade(() => {
                                                            setDistritoSelecionado(atual =>
                                                                atual === codigo ? null : codigo
                                                            );
                                                        });
                                                    });

                                                }}
                                            />
                                        )
                                    }

                                    {/* MALHA TÉRMICA CONTÍNUA */}
                                    {
                                        municipio &&
                                        mostrarAmostras &&
                                        modoVisualizacaoTermica === 'malha' &&
                                        perfilMunicipio &&
                                        (geometriaDistritoSelecionado || geometriaMunicipio) && (
                                            <MalhaTermicaPontilhada
                                                geometria={
                                                    geometriaDistritoSelecionado?.geometry ??
                                                    geometriaMunicipio!.geometry
                                                }
                                                pontos={perfilMunicipio.pontos}
                                                minima={perfilMunicipio.minima}
                                                maxima={perfilMunicipio.maxima}
                                                modoEscala={escalaTermica}
                                                modoInspecao={inspecaoTermica}
                                                onSelecionar={selecionarInspecao}
                                                focoInspecionado={pontoInspecionado}
                                                quenturaEmDestaque={quenturaEmDestaque}
                                            />
                                        )
                                    }

                                    {/* PONTOS DA AMOSTRAGEM TÉRMICA MUNICIPAL */}
                                    {
                                        municipio &&
                                        mostrarAmostras &&
                                        modoVisualizacaoTermica === 'amostras' &&
                                        perfilMunicipio &&
                                        pontosVisiveis.map((ponto, indice) => (
                                            <CircleMarker
                                                key={`${municipio.codigo}-amostra-${indice}`}
                                                center={[ponto.latitude, ponto.longitude]}
                                                radius={6}
                                                pathOptions={{
                                                    color: '#FFFFFF',
                                                    weight: 2,
                                                    fillColor: escalaTermica === 'contraste'
                                                        ? corPontoTermicoContraste(
                                                            ponto.temperatura,
                                                            perfilMunicipio.media,
                                                            perfilMunicipio.minima,
                                                            perfilMunicipio.maxima
                                                        )
                                                        : corPontoTermicoAbsoluta(
                                                            ponto.temperatura
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
                                                        <strong>Ponto do modelo {indice + 1}</strong>
                                                        <div>
                                                            {ponto.temperatura.toFixed(1)
                                                                .replace('.', ',')} °C
                                                        </div>
                                                    </div>
                                                </Tooltip>

                                                <Popup>
                                                    <div style={{ lineHeight: 1.7 }}>
                                                        <strong>Ponto do modelo {indice + 1}</strong>

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

                            {/* CONCENTRAÇÃO ESPACIAL DE RELATOS DE QUENTURA */}
                            {municipio &&
                                mostrarConcentracaoQuentura &&
                                relatosEmConcentracao.length >= 2 && (
                                    <CamadaConcentracaoQuentura
                                        relatos={relatosEmConcentracao}
                                    />
                                )}

                            {/* RELATOS COMUNITÁRIOS DE QUENTURA */}
                            {municipio &&
                                mostrarRelatosQuentura &&
                                relatosQuenturaDoTerritorio.map(relato => (
                                    <Marker
                                        key={`quentura-${relato.id}`}
                                        position={[
                                            relato.latitude,
                                            relato.longitude
                                        ]}
                                        icon={ICONE_QUENTURA}
                                        title={`Quentura: ${relato.titulo}`}
                                    >
                                        <Tooltip direction="top" offset={[0, -18]}>
                                            Relato de Quentura • {relato.titulo}
                                        </Tooltip>

                                        <Popup>
                                            <div style={{ minWidth: 180, lineHeight: 1.6 }}>
                                                <strong>Quentura relatada pela comunidade</strong>

                                                <p>{relato.titulo}</p>

                                                {relato.detalhe && (
                                                    <p>{relato.detalhe}</p>
                                                )}

                                                <small>
                                                    Registro comunitário CUIDAÍ.
                                                    Não representa medição meteorológica.
                                                </small>
                                            </div>
                                        </Popup>
                                    </Marker>
                                ))
                            }

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

                            <BairrosAtlas
                                bairros={bairrosDoMunicipio}
                                ativo={
                                    bairrosDoMunicipio !== null &&
                                    !mostrarAmostras
                                }
                            />

                        </MapContainer>
                    </div>


                    <div
                        className="atlas-controles-superiores"
                        style={{
                            order: 1,
                            display: 'flex',
                            alignItems: 'flex-start',
                            gap: '8px',
                            flexWrap: 'nowrap',
                            width: '100%',
                            minWidth: 0
                        }}
                    >



                        {/* SELETOR TERRITORIAL COMPACTO */}
                        {(municipio?.codigo === '2305654' ||
                            municipio?.codigo === '2304400') && (
                                <div
                                    className="atlas-distritos-etiqueta"
                                    style={{
                                        order: 0,
                                        flex: '0 0 175px',
                                        width: '175px',
                                        minWidth: '175px',
                                        maxWidth: '175px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'stretch',
                                        justifyContent: 'center',
                                        gap: '5px',
                                        padding: '8px 10px',
                                        margin: 0,
                                        borderRadius: '14px',
                                        border: '1px solid #D8E2EE',
                                        background: '#F7FAFE',
                                        boxSizing: 'border-box',
                                        textAlign: 'left'
                                    }}
                                >
                                    <label
                                        htmlFor="atlas-seletor-territorio"
                                        style={{
                                            fontSize: '12px',
                                            fontWeight: 700,
                                            color: '#214563'
                                        }}
                                    >
                                        {municipio.codigo === '2304400'
                                            ? 'Regional'
                                            : 'Distrito'}
                                    </label>

                                    <select
                                        id="atlas-seletor-territorio"
                                        value={distritoSelecionado ?? ''}
                                        disabled={!divisoesAtivas}
                                        onChange={evento => {
                                            const codigo = evento.target.value || null;

                                            setPontoInspecionado(null);

                                            navegarComFade(() => {
                                                setDistritoSelecionado(codigo);
                                            });
                                        }}
                                        style={{
                                            flex: 'none',
                                            width: '100%',
                                            minWidth: 0,
                                            maxWidth: '100%',
                                            height: '34px',
                                            minHeight: '34px',
                                            maxHeight: '34px',
                                            boxSizing: 'border-box',
                                            border: '1px solid #DCE6F0',
                                            borderRadius: '9px',
                                            padding: '0 10px',
                                            backgroundColor: '#FFFFFF',
                                            color: '#192942',
                                            fontFamily: 'inherit',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: 'pointer'
                                        }}
                                    >
                                        <option value="">
                                            {municipio.codigo === '2304400'
                                                ? 'Todas as regionais'
                                                : 'Todos os distritos'}
                                        </option>

                                        {divisoesAtivas?.features.map((feature, indice) => {
                                            const codigo = String(
                                                feature.properties?.CD_DIST ??
                                                feature.properties?.id ??
                                                ''
                                            );

                                            if (!codigo) return null;

                                            const nome = String(
                                                feature.properties?.NM_DIST ??
                                                feature.properties?.regiao_adm ??
                                                feature.properties?.Nome ??
                                                `Área ${indice + 1}`
                                            );

                                            return (
                                                <option key={codigo} value={codigo}>
                                                    {nome}
                                                </option>
                                            );
                                        })}
                                    </select>

                                    {erroTerritorial && (
                                        <span style={{
                                            color: '#B42318',
                                            fontSize: '11px'
                                        }}>
                                            {erroTerritorial}
                                        </span>
                                    )}
                                </div>
                            )}


                        {/* BARRA DE FERRAMENTAS E LEGENDA TÉRMICA */}
                        {municipio && (
                            <section
                                className="atlas-toolbar"
                                aria-label="Camadas e escala do Atlas"
                                style={{
                                    order: 1,
                                    flex: '1 1 0',
                                    minWidth: 0,
                                    marginTop: 0,
                                    boxSizing: 'border-box'
                                }}
                            >
                                <div className="atlas-toolbar__acoes">

                                    {/* MALHA E PONTOS */}
                                    <div
                                        className="atlas-toolbar__grupo"
                                        role="group"
                                        aria-label="Visualização térmica"
                                    >
                                        <button
                                            type="button"
                                            disabled={!perfilMunicipio}
                                            className={`atlas-toolbar__botao ${mostrarAmostras &&
                                                modoVisualizacaoTermica === 'malha'
                                                ? 'atlas-toolbar__botao--ativo'
                                                : ''
                                                }`}
                                            aria-pressed={
                                                mostrarAmostras &&
                                                modoVisualizacaoTermica === 'malha'
                                            }
                                            onClick={() => {
                                                if (
                                                    mostrarAmostras &&
                                                    modoVisualizacaoTermica === 'malha'
                                                ) {
                                                    setMostrarAmostras(false);
                                                } else {
                                                    setModoVisualizacaoTermica('malha');
                                                    setMostrarAmostras(true);
                                                }
                                            }}
                                        >
                                            <FiGrid size={15} />
                                            <span>Malha</span>
                                        </button>

                                        <button
                                            type="button"
                                            disabled={!perfilMunicipio}
                                            className={`atlas-toolbar__botao ${mostrarAmostras &&
                                                modoVisualizacaoTermica === 'amostras'
                                                ? 'atlas-toolbar__botao--ativo'
                                                : ''
                                                }`}
                                            aria-pressed={
                                                mostrarAmostras &&
                                                modoVisualizacaoTermica === 'amostras'
                                            }
                                            onClick={() => {
                                                if (
                                                    mostrarAmostras &&
                                                    modoVisualizacaoTermica === 'amostras'
                                                ) {
                                                    setMostrarAmostras(false);
                                                } else {
                                                    setModoVisualizacaoTermica('amostras');
                                                    setMostrarAmostras(true);
                                                }
                                            }}
                                        >
                                            <FiCircle size={14} />
                                            <span>Pontos</span>
                                            <span className="atlas-toolbar__contador">
                                                {pontosVisiveis.length}
                                            </span>
                                        </button>
                                    </div>

                                    <span
                                        className="atlas-toolbar__separador"
                                        aria-hidden="true"
                                    />

                                    {/* RELATOS DE QUENTURA */}
                                    <button
                                        type="button"
                                        disabled={relatosQuenturaDoTerritorio.length === 0}
                                        className={`atlas-toolbar__botao atlas-toolbar__botao--avulso ${mostrarRelatosQuentura
                                            ? 'atlas-toolbar__botao--quentura'
                                            : ''
                                            }`}
                                        aria-pressed={mostrarRelatosQuentura}
                                        onClick={() =>
                                            setMostrarRelatosQuentura(atual => !atual)
                                        }
                                    >
                                        <FiThermometer size={16} />
                                        <span>Quentura</span>
                                        <span className="atlas-toolbar__contador">
                                            {relatosQuenturaDoTerritorio.length}
                                        </span>
                                    </button>

                                    {/* CONCENTRAÇÃO DE RELATOS */}
                                    <button
                                        type="button"
                                        disabled={relatosEmConcentracao.length < 2}
                                        className={`atlas-toolbar__botao atlas-toolbar__botao--avulso ${mostrarConcentracaoQuentura &&
                                            relatosEmConcentracao.length >= 2
                                            ? 'atlas-toolbar__botao--quentura'
                                            : ''
                                            }`}
                                        aria-pressed={
                                            mostrarConcentracaoQuentura &&
                                            relatosEmConcentracao.length >= 2
                                        }
                                        onClick={() =>
                                            setMostrarConcentracaoQuentura(atual => !atual)
                                        }
                                    >
                                        <FiActivity size={16} />
                                        <span>Concentração</span>
                                    </button>

                                    <span className="atlas-toolbar__espaco" />

                                    {/* ESCALA TÉRMICA */}
                                    <div
                                        className="atlas-toolbar__grupo atlas-toolbar__grupo--escala"
                                        role="group"
                                        aria-label="Escala de temperatura"
                                    >
                                        <button
                                            type="button"
                                            className={`atlas-toolbar__botao ${escalaTermica === 'contraste'
                                                ? 'atlas-toolbar__botao--ativo'
                                                : ''
                                                }`}
                                            aria-pressed={escalaTermica === 'contraste'}
                                            onClick={() => setEscalaTermica('contraste')}
                                        >
                                            Contraste
                                        </button>

                                        <button
                                            type="button"
                                            className={`atlas-toolbar__botao ${escalaTermica === 'absoluta'
                                                ? 'atlas-toolbar__botao--ativo'
                                                : ''
                                                }`}
                                            aria-pressed={escalaTermica === 'absoluta'}
                                            onClick={() => setEscalaTermica('absoluta')}
                                        >
                                            °C
                                        </button>
                                    </div>
                                </div>

                                {/* LEGENDA TÉRMICA */}
                                {mostrarAmostras && perfilMunicipio && (
                                    <div className="atlas-toolbar__legenda">
                                        <div className="atlas-toolbar__legenda-topo">
                                            <span>
                                                {escalaTermica === 'contraste'
                                                    ? 'Contraste térmico'
                                                    : 'Temperatura estimada'}
                                            </span>

                                            <strong>
                                                {escalaTermica === 'contraste'
                                                    ? `Média ${perfilMunicipio.media
                                                        .toFixed(1).replace('.', ',')} °C`
                                                    : 'Escala 20–40 °C'}
                                            </strong>
                                        </div>

                                        <div className="atlas-toolbar__gradiente" />

                                        <div className="atlas-toolbar__marcas">
                                            {escalaTermica === 'contraste' ? (
                                                <>
                                                    <span>
                                                        −{faixaContrasteLegenda
                                                            .toFixed(1).replace('.', ',')} °C
                                                    </span>
                                                    <span>0</span>
                                                    <span>
                                                        +{faixaContrasteLegenda
                                                            .toFixed(1).replace('.', ',')} °C
                                                    </span>
                                                </>
                                            ) : (
                                                <>
                                                    <span>≤20°</span>
                                                    <span>25°</span>
                                                    <span>30°</span>
                                                    <span>35°</span>
                                                    <span>≥40°</span>
                                                </>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {erroAmostras && !perfilMunicipio && (
                                    <span className="atlas-toolbar__erro">
                                        Dados meteorológicos temporariamente indisponíveis.
                                    </span>
                                )}
                            </section>
                        )}

                    </div>


                    {pontoInspecionado &&
                        perfilMunicipio &&
                        mostrarAmostras &&
                        modoVisualizacaoTermica === 'malha' && (
                            <div
                                className="atlas-leitura-local"
                                role="status"
                                style={{ order: 3 }}
                            >

                                <div className="atlas-leitura-local__conteudo">
                                    <span className="atlas-leitura-local__local">
                                        {nomeTerritorioInspecionado}
                                    </span>

                                    <div className="atlas-leitura-local__valor">
                                        <strong>
                                            {pontoInspecionado.temperatura
                                                .toFixed(1).replace('.', ',')} °C
                                        </strong>

                                        <span>
                                            {(
                                                pontoInspecionado.temperatura -
                                                perfilMunicipio.media
                                            ) >= 0 ? '+' : ''}
                                            {(
                                                pontoInspecionado.temperatura -
                                                perfilMunicipio.media
                                            ).toFixed(1).replace('.', ',')} °C
                                        </span>
                                    </div>

                                    <p>
                                        {interpretarTemperatura(
                                            pontoInspecionado.temperatura -
                                            perfilMunicipio.media
                                        )}
                                    </p>
                                </div>

                                <a
                                    className="atlas-leitura-local__fonte"
                                    href="https://open-meteo.com/"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    title="Fonte dos dados: Open-Meteo. Temperatura interpolada, não medida neste ponto."
                                >
                                    <img
                                        src="https://open-meteo.com/favicon.ico"
                                        width="15"
                                        height="15"
                                        alt=""
                                    />
                                    <span>Open-Meteo</span>
                                </a>

                                <button
                                    type="button"
                                    className="atlas-leitura-local__fechar"
                                    onClick={() => setPontoInspecionado(null)}
                                    aria-label="Fechar inspeção"
                                >
                                    ×
                                </button>
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



            <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#718096' }}>
                {municipio
                    ? municipio.codigo === '2305654'
                        ? 'Clique em um distrito para destacá-lo. Limites distritais do IBGE, Censo 2022.'
                        : 'Mapa geográfico restrito aos limites municipais. Detalhamento distrital em preparação.'
                    : estaNoCeara
                        ? 'Passe o cursor sobre um município para destacar sua região de planejamento. Clique para explorar.'
                        : estado
                            ? `${estado.sigla} • A divisão municipal dos demais estados será incorporada nas próximas etapas.`
                            : 'Selecione um estado para explorar o território.'}
            </p>
        </div>
    );
}
