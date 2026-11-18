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
    FiArrowLeft,
    FiSearch,
    FiX
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
    useMap,
    useMapEvents
} from 'react-leaflet';
import L from 'leaflet';
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

type ResultadoBuscaAtlas = {
    chave: string;
    tipo: 'estado' | 'municipio' | 'bairro';
    nome: string;
    descricao: string;
    estado: EstadoAtlas;
    municipio?: MunicipioAtlas;
};

function nomeBairroAtlas(feature: Feature): string {
    const props = feature.properties ?? {};
    const nome = [
        props.Nome, props.nome, props.NOME,
        props.bairro, props.BAIRRO, props.nome_bairro,
        props.NM_BAIRRO, props.name
    ].find(valor => typeof valor === 'string' && valor.trim().length > 0);
    return typeof nome === 'string' ? nome.trim() : '';
}


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
    focoInspecionado
}: {
    geometria: Geometry;
    pontos: PerfilTermicoMunicipal['pontos'];
    minima: number;
    maxima: number;
    modoEscala: EscalaTermica;
    modoInspecao: boolean;
    onSelecionar: (ponto: PontoInspecionado | null) => void;
    focoInspecionado: PontoInspecionado | null;
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

        const espacamento = 11;
        const raio = 2.4;

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
                        ? 2.2 + 4.8 * influencia
                        : raio;

                    contexto.globalAlpha = centroFoco
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

                    contexto.fillStyle = cor;

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
                    contexto.strokeStyle = 'rgba(25, 41, 66, 0.16)';
                    contexto.lineWidth = 0.4;
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
        focoInspecionado
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
    distritoSelecionado,
    bairroAlvo
}: {
    dados: FeatureCollection;
    estado: EstadoAtlas | null;
    municipios: FeatureCollection | null;
    municipio: MunicipioAtlas | null;
    distritos: FeatureCollection | null;
    distritoSelecionado: string | null;
    bairroAlvo: Feature | null;
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

        const geometria = bairroAlvo ?? distritoAtual
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
                    padding: !estado ? [8, 8] : [28, 28],
                    maxZoom: bairroAlvo ? 15 : distritoAtual ? 13 : undefined,
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
        distritoSelecionado,
        bairroAlvo
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

// MARCADOR DE RELATO COMUNITÁRIO DE QUENTURA
const ICONE_QUENTURA = L.divIcon({
    className: 'atlas-relato-quentura',
    html: `
        <span class="atlas-relato-quentura__centro">
            <svg
                width="13"
                height="13"
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
    iconSize: [34, 34],
    iconAnchor: [17, 17],
    popupAnchor: [0, -17]
});


/**
 * Agrupa apenas os relatos cujos marcadores se sobrepõem na tela.
 * A posição exibida pertence sempre a um relato real: nenhum dado é alterado.
 * O agrupamento é recalculado ao mudar o zoom/tamanho do mapa.
 */
function MarcadoresQuentura({
    relatos
}: {
    relatos: RelatoQuenturaAtlas[];
}) {
    const [revisaoMapa, setRevisaoMapa] = useState(0);
    const map = useMapEvents({
        zoomend: () => setRevisaoMapa(atual => atual + 1),
        moveend: () => setRevisaoMapa(atual => atual + 1),
        resize: () => setRevisaoMapa(atual => atual + 1)
    });

    const grupos = useMemo(() => {
        // A revisão invalida as coordenadas projetadas após mudanças no mapa.
        void revisaoMapa;
        const zoom = map.getZoom();
        const itens = relatos
            .filter(relato =>
                Number.isFinite(relato.latitude) &&
                Number.isFinite(relato.longitude)
            )
            .map(relato => ({
                relato,
                pixel: map.project(
                    L.latLng(relato.latitude, relato.longitude),
                    zoom
                )
            }));

        // O círculo visível mede 20 px. Com 28 px, evitamos
        // chamas encostadas e mantemos os agrupamentos compactos.
        const raioPixels = 28;
        const raiz = itens.map((_, indice) => indice);
        const localizarRaiz = (indiceInicial: number): number => {
            let indice = indiceInicial;
            while (raiz[indice] !== indice) {
                raiz[indice] = raiz[raiz[indice]];
                indice = raiz[indice];
            }
            return indice;
        };
        const unir = (primeiro: number, segundo: number) => {
            const a = localizarRaiz(primeiro);
            const b = localizarRaiz(segundo);
            if (a !== b) raiz[b] = a;
        };

        // Grade espacial: compara apenas ícones em células próximas.
        const celulas = new Map<string, number[]>();
        itens.forEach(({ pixel }, indice) => {
            const coluna = Math.floor(pixel.x / raioPixels);
            const linha = Math.floor(pixel.y / raioPixels);

            for (let dx = -1; dx <= 1; dx++) {
                for (let dy = -1; dy <= 1; dy++) {
                    const vizinhos = celulas.get(
                        `${coluna + dx}:${linha + dy}`
                    ) ?? [];
                    for (const outro of vizinhos) {
                        const distanciaX = pixel.x - itens[outro].pixel.x;
                        const distanciaY = pixel.y - itens[outro].pixel.y;
                        if (
                            distanciaX * distanciaX +
                            distanciaY * distanciaY <= raioPixels * raioPixels
                        ) {
                            unir(indice, outro);
                        }
                    }
                }
            }

            const chave = `${coluna}:${linha}`;
            const celula = celulas.get(chave) ?? [];
            celula.push(indice);
            celulas.set(chave, celula);
        });

        const gruposPorRaiz = new Map<number, number[]>();
        itens.forEach((_, indice) => {
            const id = localizarRaiz(indice);
            const membros = gruposPorRaiz.get(id) ?? [];
            membros.push(indice);
            gruposPorRaiz.set(id, membros);
        });

        return Array.from(gruposPorRaiz.values()).map(indices => {
            const centroX = indices.reduce(
                (total, indice) => total + itens[indice].pixel.x, 0
            ) / indices.length;
            const centroY = indices.reduce(
                (total, indice) => total + itens[indice].pixel.y, 0
            ) / indices.length;

            // Marcador na coordenada verdadeira mais próxima do centro visual.
            const representante = indices.reduce((escolhido, indice) => {
                const distancia = (i: number) =>
                    (itens[i].pixel.x - centroX) ** 2 +
                    (itens[i].pixel.y - centroY) ** 2;
                return distancia(indice) < distancia(escolhido)
                    ? indice
                    : escolhido;
            }, indices[0]);

            return {
                id: indices.map(indice => itens[indice].relato.id).sort().join('|'),
                posicao: [
                    itens[representante].relato.latitude,
                    itens[representante].relato.longitude
                ] as [number, number],
                relatos: indices.map(indice => itens[indice].relato)
            };
        });
    }, [map, relatos, revisaoMapa]);

    return (
        <>
            {grupos.map(grupo => {
                const quantidade = grupo.relatos.length;
                const individual = quantidade === 1;
                const primeiro = grupo.relatos[0];

                return (
                    <Marker
                        key={`relatos-quentura-${grupo.id}`}
                        position={grupo.posicao}
                        icon={individual
                            ? ICONE_QUENTURA
                            : criarIconeQuenturaAgrupada(quantidade)}
                        title={individual
                            ? `Quentura: ${primeiro.titulo}`
                            : `${quantidade} relatos de Quentura`}
                    >
                        <Tooltip direction="top" offset={[0, -12]}>
                            {individual
                                ? `Relato de Quentura • ${primeiro.titulo}`
                                : `${quantidade} relatos de Quentura • Clique para consultar`}
                        </Tooltip>

                        <Popup minWidth={individual ? 180 : 270} maxWidth={360}>
                            {individual ? (
                                <div style={{ lineHeight: 1.6 }}>
                                    <strong>Quentura relatada pela comunidade</strong>
                                    <p>{primeiro.titulo}</p>
                                    {primeiro.detalhe && <p>{primeiro.detalhe}</p>}
                                    {primeiro.hora && primeiro.hora !== '--:--' && (
                                        <small>Horário: {primeiro.hora}</small>
                                    )}
                                    <div>
                                        <small>
                                            Registro comunitário CUIDAÍ.
                                            Não representa medição meteorológica.
                                        </small>
                                    </div>
                                </div>
                            ) : (
                                <div className="atlas-quentura-popup">
                                    <strong>{quantidade} relatos de Quentura</strong>
                                    <p>Selecione um registro para ver suas informações.</p>
                                    <div className="atlas-quentura-popup__lista">
                                        {grupo.relatos.map((relato, indice) => (
                                            <details key={relato.id} className="atlas-quentura-popup__item">
                                                <summary>
                                                    <span>{indice + 1}.</span>
                                                    {relato.titulo}
                                                </summary>
                                                <div className="atlas-quentura-popup__detalhes">
                                                    {relato.detalhe && <p>{relato.detalhe}</p>}
                                                    {relato.hora && relato.hora !== '--:--' && (
                                                        <small>Horário: {relato.hora}</small>
                                                    )}
                                                    <small>Registro comunitário CUIDAÍ.</small>
                                                </div>
                                            </details>
                                        ))}
                                    </div>
                                    <small>
                                        Relatos da população; não representam
                                        medições meteorológicas.
                                    </small>
                                </div>
                            )}
                        </Popup>
                    </Marker>
                );
            })}
        </>
    );
}

function criarIconeQuenturaAgrupada(quantidade: number): L.DivIcon {
    const largura = quantidade >= 100 ? 62 : quantidade >= 10 ? 52 : 44;
    return L.divIcon({
        className: 'atlas-quentura-agrupada',
        html: `
            <span class="atlas-quentura-agrupada__conteudo">
                <svg width="14" height="14" viewBox="0 0 24 24"
                     fill="none" stroke="currentColor" stroke-width="2.1"
                     stroke-linecap="round" stroke-linejoin="round"
                     aria-hidden="true">
                    <path d="M12 22c4 0 7-3 7-7 0-3-2-6-4-8 0 2-1 3-3 4 0-4-2-7-4-9 0 4-1 6-3 9-1 2-1 3-1 4 0 4 3 7 8 7Z"/>
                </svg>
                <strong>${quantidade}</strong>
            </span>
        `,
        iconSize: [largura, 34],
        iconAnchor: [largura / 2, 17],
        popupAnchor: [0, -18]
    });
}


/**
 * Estações físicas: mesmo ícone "access-point-network" do aplicativo
 * CUIDAÍ, com contorno azul e dimensão proporcional ao zoom.
 * A área interativa permanece maior que o símbolo visível.
 */
const CAMINHO_ICONE_ESTACAO = 'M4.93 3.93A9.97 9.97 0 0 0 2 11c0 2.76 1.12 5.26 2.93 7.07l1.41-1.41A7.94 7.94 0 0 1 4 11c0-2.21.89-4.22 2.34-5.66zm14.14 0l-1.41 1.41A7.96 7.96 0 0 1 20 11c0 2.22-.89 4.22-2.34 5.66l1.41 1.41A9.97 9.97 0 0 0 22 11c0-2.76-1.12-5.26-2.93-7.07M7.76 6.76A5.98 5.98 0 0 0 6 11c0 1.65.67 3.15 1.76 4.24l1.41-1.41A4 4 0 0 1 8 11c0-1.11.45-2.11 1.17-2.83zm8.48 0l-1.41 1.41A4 4 0 0 1 16 11c0 1.11-.45 2.11-1.17 2.83l1.41 1.41A5.98 5.98 0 0 0 18 11c0-1.65-.67-3.15-1.76-4.24M12 9a2 2 0 0 0-2 2a2 2 0 0 0 2 2a2 2 0 0 0 2-2m-1 6v4h-1a1 1 0 0 0-1 1H2v2h7a1 1 0 0 0 1 1h4a1 1 0 0 0 1-1h7v-2h-7a1 1 0 0 0-1-1h-1v-4z';

function criarIconeEstacaoCuidai(
    tamanho: number,
    selecionada: boolean
): L.DivIcon {
    return L.divIcon({
        className: [
            'atlas-estacao-icone',
            selecionada ? 'atlas-estacao-icone--selecionada' : ''
        ].filter(Boolean).join(' '),
        html: `
            <span
                class="atlas-estacao-icone__centro"
                style="width:${tamanho}px;height:${tamanho}px;border-width:${tamanho >= 21 ? 1.5 : 1}px"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="${CAMINHO_ICONE_ESTACAO}" />
                </svg>
            </span>
        `,
        iconSize: [32, 32],
        iconAnchor: [16, 16],
        popupAnchor: [0, -14]
    });
}

function MarcadoresEstacoesCuidai({
    estacoes,
    instanteAtual,
    idSelecionada,
    onSelecionar
}: {
    estacoes: EstacaoPublica[];
    instanteAtual: number;
    idSelecionada: string | null;
    onSelecionar: (id: string | null) => void;
}) {
    const mapa = useMap();
    const [zoomAtual, setZoomAtual] = useState(() => mapa.getZoom());

    useMapEvents({
        zoomend: () => setZoomAtual(mapa.getZoom())
    });

    // Mesmo escalonamento visual do app: 11, 16, 21 ou 26 pixels.
    const tamanho = zoomAtual >= 17 ? 26 :
        zoomAtual >= 15 ? 21 :
        zoomAtual >= 13 ? 16 : 11;

    return (
        <>
            {estacoes.map(estacao => {
                const leitura = estacao.ultimaLeitura;
                const recente = leitura !== null &&
                    instanteAtual >= leitura.recebidoEm &&
                    instanteAtual - leitura.recebidoEm <= 30 * 60 * 1000;
                const selecionada = idSelecionada === estacao.id;

                return (
                    <Marker
                        key={`estacao-cuidai-${estacao.id}`}
                        position={[estacao.latitude, estacao.longitude]}
                        icon={criarIconeEstacaoCuidai(tamanho, selecionada)}
                        zIndexOffset={100}
                        title={`${estacao.nome} • Estação CUIDAÍ`}
                        eventHandlers={{
                            click: () => onSelecionar(
                                selecionada ? null : estacao.id
                            )
                        }}
                    >
                        <Tooltip direction="top" offset={[0, -12]}>
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
                                            {new Date(leitura.recebidoEm).toLocaleString('pt-BR')}
                                        </small>
                                    </>
                                ) : (
                                    <p>Sem medição disponível.</p>
                                )}
                            </div>
                        </Popup>
                    </Marker>
                );
            })}
        </>
    );
}

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

    // Pesquisa territorial discreta no cabeçalho do atlas.
    // Estados: Brasil; municípios: Ceará; bairros: Fortaleza e Ipaporanga.
    const [buscaAberta, setBuscaAberta] = useState(false);
    const [textoBusca, setTextoBusca] = useState('');
    const [indiceBusca, setIndiceBusca] = useState(0);
    const [municipiosBusca, setMunicipiosBusca] =
        useState<FeatureCollection | null>(null);
    const [carregandoBusca, setCarregandoBusca] = useState(false);
    const [erroBusca, setErroBusca] = useState<string | null>(null);
    const [bairroBuscado, setBairroBuscado] =
        useState<{ municipioCodigo: string; nome: string } | null>(null);
    const buscaRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (
            (municipio?.codigo !== '2304400' && !buscaAberta) ||
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
    }, [municipio?.codigo, bairrosFortaleza, buscaAberta]);

    // CARREGAMENTO DOS BAIRROS DE IPAPORANGA — IBGE 2022
    useEffect(() => {
        if (
            (municipio?.codigo !== '2305654' && !buscaAberta) ||
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
    }, [municipio?.codigo, bairrosIpaporanga, buscaAberta]);

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

    // Selecionar uma estação desativa os relatos sobre o mapa.
    // A seleção pelo marcador e pelo Observatório usa esta mesma função.
    const selecionarEstacao = (id: string | null) => {
        setIdEstacaoSelecionada(id);
        if (id !== null) {
            setMostrarRelatosQuentura(false);
        }
    };

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



    // O catálogo de municípios fica disponível mesmo na vista Brasil.
    // Reaproveita a mesma malha usada pelo atlas (sem geocodificar por texto).
    useEffect(() => {
        if (!buscaAberta || municipios || municipiosBusca) return;
        const controlador = new AbortController();
        setCarregandoBusca(true);
        setErroBusca(null);

        void fetch('/municipios-ceara.geojson', {
            signal: controlador.signal
        }).then(resposta => {
            if (!resposta.ok) throw new Error('Municípios indisponíveis.');
            return resposta.json();
        }).then((colecao: FeatureCollection) => {
            if (!controlador.signal.aborted) {
                if (
                    colecao.type !== 'FeatureCollection' ||
                    !Array.isArray(colecao.features)
                ) throw new Error('Catálogo municipal inválido.');
                setMunicipiosBusca(colecao);
            }
        }).catch(falha => {
            if (!controlador.signal.aborted) {
                console.error('Pesquisa de municípios:', falha);
                setErroBusca('Não foi possível carregar municípios do Ceará.');
            }
        }).finally(() => {
            if (!controlador.signal.aborted) setCarregandoBusca(false);
        });
        return () => controlador.abort();
    }, [buscaAberta, municipios, municipiosBusca]);

    useEffect(() => {
        if (!buscaAberta) return;
        const fechar = (evento: PointerEvent) => {
            if (
                evento.target instanceof Node &&
                !buscaRef.current?.contains(evento.target)
            ) setBuscaAberta(false);
        };
        document.addEventListener('pointerdown', fechar);
        return () => document.removeEventListener('pointerdown', fechar);
    }, [buscaAberta]);

    const estadoCearaBusca = useMemo<EstadoAtlas | null>(() => {
        const feature = dados?.features.find(
            item => String(item.properties?.SIGLA_UF ?? '') === 'CE'
        );
        if (!feature) return null;
        return {
            codigo: String(feature.properties?.CD_UF ?? ''),
            nome: String(feature.properties?.NM_UF ?? 'Ceará'),
            sigla: 'CE'
        };
    }, [dados]);

    const resultadosBusca = useMemo<ResultadoBuscaAtlas[]>(() => {
        const consulta = chaveRegiao(textoBusca);
        if (!consulta) return [];
        const palavras = consulta.split(' ').filter(Boolean);
        const candidatos: ResultadoBuscaAtlas[] = [];

        dados?.features.forEach(feature => {
            const props = feature.properties ?? {};
            const estadoBusca: EstadoAtlas = {
                codigo: String(props.CD_UF ?? ''),
                nome: String(props.NM_UF ?? ''),
                sigla: String(props.SIGLA_UF ?? '')
            };
            if (estadoBusca.nome && estadoBusca.codigo) {
                candidatos.push({
                    chave: `estado-${estadoBusca.codigo}`,
                    tipo: 'estado',
                    nome: estadoBusca.nome,
                    descricao: `Estado · ${estadoBusca.sigla}`,
                    estado: estadoBusca
                });
            }
        });

        if (estadoCearaBusca) {
            (municipios ?? municipiosBusca)?.features.forEach(feature => {
                const codigo = String(feature.properties?.id ?? '');
                const nome = String(feature.properties?.name ?? '').trim();
                if (!codigo || !nome) return;
                candidatos.push({
                    chave: `municipio-${codigo}`,
                    tipo: 'municipio',
                    nome,
                    descricao: 'Município · Ceará',
                    estado: estadoCearaBusca,
                    municipio: { codigo, nome }
                });
            });

            const bairrosPorCidade: Array<{
                colecao: FeatureCollection | null;
                codigo: string;
                cidade: string;
            }> = [
                { colecao: bairrosFortaleza, codigo: '2304400', cidade: 'Fortaleza' },
                { colecao: bairrosIpaporanga, codigo: '2305654', cidade: 'Ipaporanga' }
            ];
            bairrosPorCidade.forEach(({ colecao, codigo, cidade }) => {
                colecao?.features.forEach(feature => {
                    const nome = nomeBairroAtlas(feature);
                    if (!nome) return;
                    candidatos.push({
                        chave: `bairro-${codigo}-${chaveRegiao(nome)}`,
                        tipo: 'bairro',
                        nome,
                        descricao: `Bairro · ${cidade}, Ceará`,
                        estado: estadoCearaBusca,
                        municipio: { codigo, nome: cidade }
                    });
                });
            });
        }

        const pontuacao = (resultado: ResultadoBuscaAtlas) => {
            const nome = chaveRegiao(resultado.nome);
            const sigla = chaveRegiao(resultado.estado.sigla);
            const contexto = chaveRegiao(`${resultado.nome} ${resultado.descricao}`);
            if (!palavras.every(palavra =>
                contexto.includes(palavra) ||
                (resultado.tipo === 'estado' && sigla === palavra)
            )) return -1;
            return nome === consulta || (resultado.tipo === 'estado' && sigla === consulta)
                ? 0 : nome.startsWith(consulta) ? 1 : nome.includes(consulta) ? 2 : 3;
        };

        return candidatos
            .map(resultado => ({ resultado, ordem: pontuacao(resultado) }))
            .filter(item => item.ordem >= 0)
            .sort((a, b) =>
                a.ordem - b.ordem ||
                a.resultado.nome.localeCompare(b.resultado.nome, 'pt-BR') ||
                a.resultado.tipo.localeCompare(b.resultado.tipo)
            ).slice(0, 10).map(item => item.resultado);
    }, [
        textoBusca, dados, estadoCearaBusca, municipios, municipiosBusca,
        bairrosFortaleza, bairrosIpaporanga
    ]);

    const geometriaBairroBuscado = useMemo<Feature | null>(() => {
        if (!bairroBuscado || municipio?.codigo !== bairroBuscado.municipioCodigo) {
            return null;
        }
        const colecao = bairroBuscado.municipioCodigo === '2304400'
            ? bairrosFortaleza : bairrosIpaporanga;
        return colecao?.features.find(feature =>
            chaveRegiao(nomeBairroAtlas(feature)) === chaveRegiao(bairroBuscado.nome)
        ) ?? null;
    }, [bairroBuscado, municipio?.codigo, bairrosFortaleza, bairrosIpaporanga]);

    const escolherResultadoBusca = (resultado: ResultadoBuscaAtlas) => {
        if (transicaoEmCurso.current) return;
        setBuscaAberta(false);
        setTextoBusca('');
        setIndiceBusca(0);
        navegarComFade(() => {
            toqueTerritorioPendente.current = null;
            setPontoInspecionado(null);
            setPerfilMapa(null);
            setMostrarAmostras(false);
            setIdEstacaoSelecionada(null);
            setMostrarRelatosQuentura(false);
            setDistritoSelecionado(null);
            setBairroBuscado(
                resultado.tipo === 'bairro' && resultado.municipio
                    ? {
                        municipioCodigo: resultado.municipio.codigo,
                        nome: resultado.nome
                    }
                    : null
            );
            setEstado(resultado.estado);
            setMunicipio(resultado.tipo === 'estado'
                ? null : resultado.municipio ?? null);
        });
    };

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
        import.meta.env.VITE_CARTO_KEY ?? ''
    ).trim();

    const usarMapaSemRotulos =
        Boolean(municipio) &&
        mostrarAmostras &&
        modoVisualizacaoTermica === 'malha' &&
        chaveCarto.length > 0;

    // Limites discretos durante a visualização térmica
    const estiloDivisoes: L.PathOptions =
        mostrarAmostras && modoVisualizacaoTermica === 'malha'
            ? {
                color: '#A9C2D2',
                weight: 0.8,
                opacity: 0.5,
                fillColor: '#FFFFFF',
                fillOpacity: 0.01
            }
            : {
                color: '#66A7D3',
                weight: 1.5,
                opacity: 1,
                fillColor: '#FFFFFF',
                fillOpacity: 0.01
            };

    const estiloTerritorio = (): L.PathOptions => {
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
                poligono.setStyle(estiloTerritorio());
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
                    {geometriaBairroBuscado && bairroBuscado && (
                        <span className="atlas-cabecalho__bairro">
                            Bairro {bairroBuscado.nome}
                        </span>
                    )}
                </div>

                <div className="atlas-busca" ref={buscaRef}>
                    <div className="atlas-busca__campo">
                        <FiSearch size={15} aria-hidden="true" />
                        <input
                            type="search"
                            role="combobox"
                            aria-label="Pesquisar estado, município ou bairro"
                            aria-autocomplete="list"
                            aria-expanded={buscaAberta && textoBusca.trim().length > 0}
                            aria-controls="atlas-busca-resultados"
                            placeholder="Buscar estado, município ou bairro"
                            value={textoBusca}
                            onFocus={() => setBuscaAberta(true)}
                            onChange={evento => {
                                setTextoBusca(evento.target.value);
                                setIndiceBusca(0);
                                setBuscaAberta(true);
                            }}
                            onKeyDown={evento => {
                                if (evento.key === 'Escape') {
                                    setBuscaAberta(false);
                                    evento.currentTarget.blur();
                                } else if (evento.key === 'ArrowDown' && resultadosBusca.length) {
                                    evento.preventDefault();
                                    setBuscaAberta(true);
                                    setIndiceBusca(indice =>
                                        Math.min(indice + 1, resultadosBusca.length - 1));
                                } else if (evento.key === 'ArrowUp' && resultadosBusca.length) {
                                    evento.preventDefault();
                                    setIndiceBusca(indice => Math.max(0, indice - 1));
                                } else if (evento.key === 'Enter' && resultadosBusca.length) {
                                    evento.preventDefault();
                                    escolherResultadoBusca(
                                        resultadosBusca[Math.min(indiceBusca, resultadosBusca.length - 1)]
                                    );
                                }
                            }}
                        />
                        {textoBusca && (
                            <button
                                type="button"
                                className="atlas-busca__limpar"
                                aria-label="Limpar pesquisa"
                                onClick={() => {
                                    setTextoBusca('');
                                    setIndiceBusca(0);
                                }}
                            >
                                <FiX size={14} aria-hidden="true" />
                            </button>
                        )}
                    </div>

                    {buscaAberta && textoBusca.trim().length > 0 && (
                        <div
                            id="atlas-busca-resultados"
                            className="atlas-busca__resultados"
                            role="listbox"
                            aria-label="Resultados da pesquisa territorial"
                        >
                            {resultadosBusca.length ? resultadosBusca.map((resultado, indice) => (
                                <button
                                    key={resultado.chave}
                                    type="button"
                                    role="option"
                                    aria-selected={indice === indiceBusca}
                                    className={indice === indiceBusca
                                        ? 'atlas-busca__resultado atlas-busca__resultado--ativo'
                                        : 'atlas-busca__resultado'}
                                    onMouseEnter={() => setIndiceBusca(indice)}
                                    onClick={() => escolherResultadoBusca(resultado)}
                                >
                                    <span className="atlas-busca__resultado-nome">{resultado.nome}</span>
                                    <span className="atlas-busca__resultado-nivel">{resultado.descricao}</span>
                                </button>
                            )) : (
                                <p className="atlas-busca__vazio" role="status">
                                    {carregandoBusca
                                        ? 'Carregando municípios...'
                                        : erroBusca ?? 'Nenhum local encontrado nas áreas disponíveis.'}
                                </p>
                            )}
                            <div className="atlas-busca__escopo">
                                Estados do Brasil · Municípios do Ceará · Bairros de Fortaleza e Ipaporanga
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {erro && <p style={{ color: '#B42318' }}>{erro}</p>

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
                                        setBairroBuscado(null);

                                        if (municipio) {
                                            setMunicipio(null);
                                        } else {
                                            setEstado(null);
                                        }
                                    });
                                }}
                            >
                                <FiArrowLeft size={13} />
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
                                        bairroAlvo={geometriaBairroBuscado}
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
                                                        setBairroBuscado(null);
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
                                                        setBairroBuscado(null);
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

                                                style={() => estiloDivisoes}

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
                                                            camada.setStyle(estiloDivisoes);

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
                                                        camada.setStyle(estiloDivisoes);
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

                            {/* RELATOS COMUNITÁRIOS — AGRUPAMENTO VISUAL POR ZOOM */}
                            {municipio && mostrarRelatosQuentura && (
                                <MarcadoresQuentura
                                    relatos={relatosQuenturaDoTerritorio}
                                />
                            )}

                            {/* ESTAÇÕES CUIDAÍ — MESMO ÍCONE DO APLICATIVO */}
                            {municipio && !mostrarRelatosQuentura && (
                                <MarcadoresEstacoesCuidai
                                    estacoes={estacoesDoTerritorio}
                                    instanteAtual={instanteAtual}
                                    idSelecionada={idEstacaoAtiva}
                                    onSelecionar={selecionarEstacao}
                                />
                            )}

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
                                                setBairroBuscado(null);
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
                                        onClick={() => {
                                            const ativar = !mostrarRelatosQuentura;
                                            setMostrarRelatosQuentura(ativar);
                                            if (ativar) {
                                                setIdEstacaoSelecionada(null);
                                            }
                                        }}
                                    >
                                        <FiThermometer size={16} />
                                        <span>Quentura</span>
                                        <span className="atlas-toolbar__contador">
                                            {relatosQuenturaDoTerritorio.length}
                                        </span>
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

                                        <span className="atlas-toolbar__referencia-modelo">
                                            Open-Meteo • referência {perfilMunicipio.horario.replace('T', ' às ')}
                                        </span>

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
                                onSelecionarEstacao={selecionarEstacao}
                                codigoMunicipio={municipio.codigo}
                                municipiosCeara={municipios}
                            />
                        )}

                </aside>

            </div>



            <p style={{ margin: '12px 0 0', fontSize: '12px', color: '#718096' }}>
                {municipio
                    ? municipio.codigo === '2305654'
                        ? 'Selecione um distrito no menu para explorar sua área. Divisões distritais: IBGE.'
                        : municipio.codigo === '2304400'
                            ? 'Selecione uma regional no menu para consultar suas informações territoriais.'
                            : 'Visualização geográfica dos limites municipais.'
                    : estaNoCeara
                        ? 'Selecione um município para explorar o território. No computador, passe o cursor para destacar sua região.'
                        : estado
                            ? `${estado.sigla} • Exploração municipal disponível atualmente para o Ceará.`
                            : 'Selecione um estado para explorar o território.'}
            </p>
        </div>
    );
}
