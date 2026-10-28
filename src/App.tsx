import { useEffect, useRef, useState } from 'react';
import {
  MapContainer,
  TileLayer,
  Marker,
  Popup,
  CircleMarker,
  GeoJSON,
  Pane,
  useMap,
  useMapEvents
} from 'react-leaflet';
import type {
  Feature,
  FeatureCollection
} from 'geojson';
import {
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  where
} from 'firebase/firestore';
import AtlasBrasil from './AtlasBrasil';
import { db } from './firebase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, AreaChart, Area, CartesianGrid } from 'recharts';
import L, { divIcon } from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

// 💡 IMPORTAÇÃO DOS ÍCONES (Adicionado MdMenu e MdClose)
import {
  MdSpaceDashboard,
  MdMenu,
  MdClose,
  MdMemory,
  MdCloud,
  MdArrowForward,
  MdArrowBack
} from 'react-icons/md';
import { AiOutlineHeatMap } from 'react-icons/ai';
import {
  FaDownload,
  FaInfoCircle,
  FaAndroid,
  FaApple
} from 'react-icons/fa';

interface Alerta {
  id: string;
  latitude: number;
  longitude: number;
  categoria: string;
  titulo: string;
  detalhe?: string;
  hora?: string;
  criadoEm?: number;
  milimetrosChuva?: number;
  votosConfirma?: number;
  votosResolvido?: number;
  autor?: string;
  temFoto?: boolean;
  fotoUrl?: string;
}

interface EstacaoMeteo {
  id: string;
  nome: string;
  municipio: string;
  latitude: number;
  longitude: number;
  experimental: boolean;
  ultimaLeitura: {
    temperatura: number;
    umidade: number;
    recebidoEm: number;
  } | null;
}
interface LeituraHistoricaMeteo {
  id: string;
  temperatura: number;
  umidade: number;
  recebidoEm: number;
  momento: string;
}

const CORES = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE'];

const GRADIENTES_CALOR: Record<string, any> = {
  'Chuvas': { 0.1: '#bae6fd', 0.39: '#bae6fd', 0.4: '#38bdf8', 0.59: '#38bdf8', 0.6: '#0284c7', 0.79: '#0284c7', 0.8: '#1d4ed8', 0.99: '#1d4ed8', 1.0: '#1e3a8a' },
  'Passagem': { 0.1: '#fef08a', 0.39: '#fef08a', 0.4: '#fbbf24', 0.59: '#fbbf24', 0.6: '#f97316', 0.79: '#f97316', 0.8: '#ea580c', 0.99: '#ea580c', 1.0: '#9a3412' },
  'Energia': { 0.1: '#e9d5ff', 0.39: '#e9d5ff', 0.4: '#c084fc', 0.59: '#c084fc', 0.6: '#a855f7', 0.79: '#a855f7', 0.8: '#7e22ce', 0.99: '#7e22ce', 1.0: '#4c1d95' },
  'Todas': { 0.1: 'rgba(0, 122, 255, 0.4)', 0.39: 'rgba(0, 122, 255, 0.4)', 0.4: 'cyan', 0.59: 'cyan', 0.6: 'lime', 0.79: 'lime', 0.8: 'orange', 0.99: 'orange', 1.0: 'red' },
  'Estrada': { 0.1: '#d9f99d', 0.39: '#d9f99d', 0.4: '#86efac', 0.59: '#86efac', 0.6: '#4ade80', 0.79: '#4ade80', 0.8: '#65a30d', 0.99: '#65a30d', 1.0: '#3f6212' },
  'Quentura': {
    0.1: '#ffe7a2',
    0.39: '#ffe7a2',
    0.4: '#ffc566',
    0.59: '#ffc566',
    0.6: '#f68b45',
    0.79: '#f68b45',
    0.8: '#df573b',
    0.99: '#df573b',
    1.0: '#a92839'
  },
};

const getGradiente = (filtro: string) => {
  if (filtro.includes('Chuva')) return GRADIENTES_CALOR['Chuvas'];
  if (filtro.includes('Passagem')) return GRADIENTES_CALOR['Passagem'];
  if (filtro.includes('Energia')) return GRADIENTES_CALOR['Energia'];
  if (filtro.includes('Estrada')) return GRADIENTES_CALOR['Estrada'];
  if (filtro.includes('Quentura')) return GRADIENTES_CALOR['Quentura'];
  return GRADIENTES_CALOR['Todas'];
};

function CamadaCalor({ alertas, gradiente }: { alertas: Alerta[], gradiente: any }) {
  const map = useMap();
  useEffect(() => {
    if (!map || alertas.length === 0) return;
    const pontos = alertas.map(a => [a.latitude, a.longitude, 0.4] as [number, number, number]);
    const heatLayer = (L as any).heatLayer(pontos, {
      radius: 35, blur: 15, maxZoom: 15, max: 1.0, minOpacity: 0.5, gradient: gradiente
    }).addTo(map);
    return () => { map.removeLayer(heatLayer); };
  }, [map, alertas, gradiente]);
  return null;
}

// DADOS METEOROLÓGICOS ESTIMADOS PELA OPEN-METEO
interface DadosOpenMeteo {
  temperatura: number;
  sensacao: number;
  umidade: number;
  vento: number;
  horario: string;
}


type PontoGradeTermica = {
  latitude: number;
  longitude: number;
  temperatura: number;
  horarioModelo: number;
};

type PontoGradeLocal = {
  latitude: number;
  longitude: number;
  temperatura: number;
};

// RESOLUÇÃO DA GRADE METEOROLÓGICA
const LINHAS_GRADE_TERMICA = 9;
const COLUNAS_GRADE_TERMICA = 11;

const TOTAL_PONTOS_GRADE_TERMICA =
  LINHAS_GRADE_TERMICA * COLUNAS_GRADE_TERMICA;

// Área preliminar de estudo: Ceará e entorno.
// Ainda não representa o limite administrativo do estado.
const LIMITES_GRADE_TERMICA = {
  sul: -8.1,
  norte: -2.5,
  oeste: -41.7,
  leste: -37.0
};


type EscalaTermica = {
  minimo: number;
  maximo: number;
};

// Determina a escala com base nas temperaturas recebidas.
function obterEscalaTermica(
  pontos: PontoGradeTermica[]
): EscalaTermica {
  if (pontos.length === 0) {
    return { minimo: 20, maximo: 40 };
  }

  const temperaturas = pontos.map(p => p.temperatura);

  const minimo = Math.floor(Math.min(...temperaturas));
  const maximo = Math.ceil(Math.max(...temperaturas));

  if (minimo === maximo) {
    return {
      minimo: minimo - 1,
      maximo: maximo + 1
    };
  }

  return { minimo, maximo };
}

// Converte temperatura em uma cor da escala atual.

// Faixas de temperatura com intervalos de 2 °C.

// FAIXAS DE TEMPERATURA DE 1 EM 1 °C

/*
 * ESCALA DE CORES DO MAPA CUIDAÍ
 *
 * ALTERE SOMENTE OS CÓDIGOS HEX (#)
 * PARA PERSONALIZAR AS CORES.
 *
 * Intervalos fixos de 2 °C.
 */
const ESCALA_TERMICA_CUIDAI = [
  {
    inicio: -Infinity,
    rotulo: 'Abaixo de 24 °C',
    hex: '#2467D0'
  },
  {
    inicio: 24,
    rotulo: '24 a 26 °C',
    hex: '#2176D2'
  },
  {
    inicio: 26,
    rotulo: '26 a 28 °C',
    hex: '#16B7D6'
  },
  {
    inicio: 28,
    rotulo: '28 a 30 °C',
    hex: '#27C782'
  },
  {
    inicio: 30,
    rotulo: '30 a 32 °C',
    hex: '#5bdb20'
  },
  {
    inicio: 32,
    rotulo: '32 a 34 °C',
    hex: '#fff021'
  },
  {
    inicio: 34,
    rotulo: '34 a 36 °C',
    hex: '#FF9B21'
  },
  {
    inicio: 36,
    rotulo: '36 a 38 °C',
    hex: '#FF521E'
  },
  {
    inicio: 38,
    rotulo: '38 a 40 °C',
    hex: '#C90018'
  },
  {
    inicio: 40,
    rotulo: '40 °C ou mais',
    hex: '#A80010'
  }
];

// RETORNA A COR CONFORME A TEMPERATURA

const corTemperatura = (
  valor: number,
  _minimo: number,
  _maximo: number
): number[] => {

  // CONTROLE DE SUAVIZAÇÃO DAS FRONTEIRAS
  const suavizacao = 0;

  // Converte uma cor HEX para RGB
  const converterHex = (hex: string): number[] => {
    const codigo = hex.replace('#', '');

    return [
      parseInt(codigo.substring(0, 2), 16),
      parseInt(codigo.substring(2, 4), 16),
      parseInt(codigo.substring(4, 6), 16)
    ];
  };

  // Cria transições suaves entre faixas de temperatura
  if (suavizacao > 0) {
    for (
      let i = 1;
      i < ESCALA_TERMICA_CUIDAI.length;
      i++
    ) {
      const limite = ESCALA_TERMICA_CUIDAI[i].inicio;

      if (Math.abs(valor - limite) <= suavizacao) {
        const anterior = converterHex(
          ESCALA_TERMICA_CUIDAI[i - 1].hex
        );

        const seguinte = converterHex(
          ESCALA_TERMICA_CUIDAI[i].hex
        );

        const proporcao =
          (valor - limite + suavizacao) /
          (2 * suavizacao);

        const t =
          proporcao * proporcao *
          (3 - 2 * proporcao);

        return anterior.map((canal, indice) =>
          Math.round(
            canal * (1 - t) +
            seguinte[indice] * t
          )
        );
      }
    }
  }

  // Mantém as cores HEX escolhidas para cada faixa
  const faixa = [...ESCALA_TERMICA_CUIDAI]
    .reverse()
    .find(item => valor >= item.inicio)
    ?? ESCALA_TERMICA_CUIDAI[0];

  return converterHex(faixa.hex);
};






// INTERPOLAÇÃO SUAVE DA SUPERFÍCIE METEOROLÓGICA
// Produz contornos mais arredondados entre os pontos da grade.
function interpolarTemperaturaCurva(
  pontos: PontoGradeTermica[],
  posicaoLinha: number,
  posicaoColuna: number
): number {

  const linhaBase = Math.floor(posicaoLinha);
  const colunaBase = Math.floor(posicaoColuna);

  const fracaoY = posicaoLinha - linhaBase;
  const fracaoX = posicaoColuna - colunaBase;

  const amostrar = (linha: number, coluna: number) => {
    const l = Math.max(
      0,
      Math.min(LINHAS_GRADE_TERMICA - 1, linha)
    );

    const c = Math.max(
      0,
      Math.min(COLUNAS_GRADE_TERMICA - 1, coluna)
    );

    return pontos[l * COLUNAS_GRADE_TERMICA + c]
      .temperatura;
  };

  // Interpolação cúbica Catmull-Rom
  const curva = (
    a: number,
    b: number,
    c: number,
    d: number,
    t: number
  ) => {
    return b + 0.5 * t * (
      c - a +
      t * (
        2 * a - 5 * b + 4 * c - d +
        t * (3 * (b - c) + d - a)
      )
    );
  };

  const valores: number[] = [];

  for (let i = -1; i <= 2; i++) {
    const linha = linhaBase + i;

    valores.push(
      curva(
        amostrar(linha, colunaBase - 1),
        amostrar(linha, colunaBase),
        amostrar(linha, colunaBase + 1),
        amostrar(linha, colunaBase + 2),
        fracaoX
      )
    );
  }

  const temperatura = curva(
    valores[0],
    valores[1],
    valores[2],
    valores[3],
    fracaoY
  );

  // Evita criar extremos acima ou abaixo dos
  // quatro valores observados ao redor da célula.
  const vizinhos = [
    amostrar(linhaBase, colunaBase),
    amostrar(linhaBase, colunaBase + 1),
    amostrar(linhaBase + 1, colunaBase),
    amostrar(linhaBase + 1, colunaBase + 1)
  ];

  return Math.max(
    Math.min(...vizinhos),
    Math.min(Math.max(...vizinhos), temperatura)
  );
}



function CamadaTemperaturaRegional({
  pontos,
  poligonosCeara,
  gradeLocalDisponivel
}: {
  pontos: PontoGradeTermica[];
  poligonosCeara: PoligonosCeara;
  gradeLocalDisponivel: boolean;
}) {
  const map = useMap();

  useEffect(() => {
    if (
      pontos.length !== TOTAL_PONTOS_GRADE_TERMICA ||
      poligonosCeara.length === 0
    ) return;

    // RESOLUÇÃO DA CAMADA METEOROLÓGICA
    const largura = 900;
    const altura = 1020;

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;

    const contexto = canvas.getContext('2d');
    if (!contexto) return;

    const imagem = contexto.createImageData(largura, altura);
    const limites = LIMITES_GRADE_TERMICA;
    const { minimo, maximo } = obterEscalaTermica(pontos);

    // DESENHA A CAMADA REGIONAL DE TEMPERATURA
    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {

        const posicaoLinha =
          (y / (altura - 1)) *
          (LINHAS_GRADE_TERMICA - 1);

        const posicaoColuna =
          (x / (largura - 1)) *
          (COLUNAS_GRADE_TERMICA - 1);

        // Temperatura calculada pela interpolação cúbica
        const temperatura = interpolarTemperaturaCurva(
          pontos,
          posicaoLinha,
          posicaoColuna
        );

        // Converte a temperatura na cor HEX configurada
        const cor = corTemperatura(
          temperatura,
          minimo,
          maximo
        );

        const indice = (y * largura + x) * 4;

        // Suavização da borda externa da imagem
        const distanciaBorda = Math.min(
          x,
          y,
          largura - 1 - x,
          altura - 1 - y
        );

        const transparencia = Math.min(
          1,
          distanciaBorda / 16
        );

        // Preenche os pixels da imagem
        imagem.data[indice] = cor[0];
        imagem.data[indice + 1] = cor[1];
        imagem.data[indice + 2] = cor[2];
        imagem.data[indice + 3] =
          Math.round(255 * transparencia);

      }
    }



    // ANTIALIASING — REMOVE O SERRILHADO DAS FRONTEIRAS
    // Atua apenas nos pixels próximos a mudanças de cor.
    // O interior de cada faixa permanece com sua cor original.

    const pixelsOriginais = new Uint8ClampedArray(imagem.data);

    const amostras = [
      [-0.25, -0.25],
      [0.25, -0.25],
      [-0.25, 0.25],
      [0.25, 0.25]
    ];

    for (let y = 1; y < altura - 1; y++) {
      for (let x = 1; x < largura - 1; x++) {

        const indice = (y * largura + x) * 4;

        const vizinhos = [
          indice - 4,
          indice + 4,
          indice - largura * 4,
          indice + largura * 4
        ];

        // Só processa pixels próximos à fronteira de duas cores.
        const estaNaFronteira = vizinhos.some(vizinho =>
          pixelsOriginais[vizinho] !== pixelsOriginais[indice] ||
          pixelsOriginais[vizinho + 1] !== pixelsOriginais[indice + 1] ||
          pixelsOriginais[vizinho + 2] !== pixelsOriginais[indice + 2]
        );

        if (!estaNaFronteira) continue;

        let vermelho = 0;
        let verde = 0;
        let azul = 0;

        // Quatro amostras dentro do pixel de fronteira.
        for (const [dx, dy] of amostras) {

          const posicaoLinha =
            ((y + dy) / (altura - 1)) *
            (LINHAS_GRADE_TERMICA - 1);

          const posicaoColuna =
            ((x + dx) / (largura - 1)) *
            (COLUNAS_GRADE_TERMICA - 1);

          const temperatura = interpolarTemperaturaCurva(
            pontos,
            posicaoLinha,
            posicaoColuna
          );

          const cor = corTemperatura(
            temperatura,
            minimo,
            maximo
          );

          vermelho += cor[0];
          verde += cor[1];
          azul += cor[2];
        }

        // Corrige somente este pixel da borda.
        imagem.data[indice] = Math.round(vermelho / 4);
        imagem.data[indice + 1] = Math.round(verde / 4);
        imagem.data[indice + 2] = Math.round(azul / 4);
      }
    }


    // Aplica as cores calculadas ao Canvas
    contexto.putImageData(imagem, 0, 0);

    // RECORTE DA CAMADA PELO CONTORNO DO CEARÁ
    contexto.save();
    contexto.globalCompositeOperation = 'destination-in';
    contexto.fillStyle = '#000000';
    contexto.beginPath();

    for (const poligono of poligonosCeara) {
      for (const anel of poligono) {
        anel.forEach((coordenada, indice) => {
          const longitude = coordenada[0];
          const latitude = coordenada[1];

          const x =
            ((longitude - limites.oeste) /
              (limites.leste - limites.oeste)) *
            (largura - 1);

          const y =
            ((limites.norte - latitude) /
              (limites.norte - limites.sul)) *
            (altura - 1);

          if (indice === 0) {
            contexto.moveTo(x, y);
          } else {
            contexto.lineTo(x, y);
          }
        });

        contexto.closePath();
      }
    }

    // Preserva o preenchimento dos polígonos e seus vazios.
    contexto.fill('evenodd');
    contexto.restore();

    const camada = L.imageOverlay(
      canvas.toDataURL('image/png'),
      [
        [limites.sul, limites.oeste],
        [limites.norte, limites.leste]
      ],
      {
        opacity: 0.8,
        interactive: false
      }
    );

    camada.addTo(map);

    // ==============================================
    // AQUARELA TÉRMICA CUIDAÍ
    // ==============================================

    // Áreas que o visitante já revelou.
    const areasPintadas: L.LatLng[] = [];

    // Posição temporária da janela que segue o mouse.
    let janelaAtual: L.LatLng | null = null;

    // Raio visual da janela, em pixels.
    const RAIO_JANELA = 125;

    // Limita a quantidade de áreas para preservar desempenho.
    const MAX_AREAS = 10;

    // Atualiza a parte visível da camada meteorológica.
    const atualizarAquarela = () => {
      const imagemCamada = camada.getElement();
      if (!imagemCamada) return;

      const zoom = map.getZoom();

      // No zoom regional, o mapa continua totalmente colorido.
      if (zoom < 10) {
        imagemCamada.style.maskImage = 'none';
        imagemCamada.style.setProperty(
          '-webkit-mask-image',
          'none'
        );

        camada.setOpacity(0.65);
        return;
      }

      // No zoom local, a pintura fica mais intensa
      // apenas dentro das áreas reveladas.
      camada.setOpacity(0.72);

      const posicoes = [
        ...areasPintadas,
        ...(janelaAtual ? [janelaAtual] : [])
      ];

      // Se ainda não explorou nada, o mapa fica limpo.
      if (posicoes.length === 0) {
        const mascaraVazia =
          'linear-gradient(transparent, transparent)';

        imagemCamada.style.maskImage = mascaraVazia;
        imagemCamada.style.setProperty(
          '-webkit-mask-image',
          mascaraVazia
        );
        return;
      }

      const retanguloMapa =
        map.getContainer().getBoundingClientRect();

      const retanguloImagem =
        imagemCamada.getBoundingClientRect();

      // Cada região revelada ganha uma abertura circular.
      const mascaras = posicoes.map(posicao => {
        const ponto = map.latLngToContainerPoint(posicao);

        const x =
          ponto.x -
          (retanguloImagem.left - retanguloMapa.left);

        const y =
          ponto.y -
          (retanguloImagem.top - retanguloMapa.top);

        return `radial-gradient(
      circle ${RAIO_JANELA}px at ${x}px ${y}px,
      black 0%,
      black 85%,
      transparent 100%
    )`;
      });

      const mascaraFinal = mascaras.join(', ');

      imagemCamada.style.maskImage = mascaraFinal;
      imagemCamada.style.setProperty(
        '-webkit-mask-image',
        mascaraFinal
      );
    };

    // A janela acompanha o cursor.
    const aoMoverMouse = (evento: L.LeafletMouseEvent) => {
      if (map.getZoom() < 10) return;

      janelaAtual = evento.latlng;
      atualizarAquarela();
    };

    // O clique fixa uma nova região colorida.
    const aoClicarMapa = (evento: L.LeafletMouseEvent) => {
      if (map.getZoom() < 10) return;

      areasPintadas.push(evento.latlng);

      if (areasPintadas.length > MAX_AREAS) {
        areasPintadas.shift();
      }

      atualizarAquarela();
    };

    // Quando o mouse sai do mapa, a prévia desaparece.
    const aoSairMapa = () => {
      janelaAtual = null;
      atualizarAquarela();
    };

    // Mantém as manchas nas coordenadas corretas
    // depois de mover ou aproximar o mapa.
    const aoMudarMapa = () => {
      atualizarAquarela();
    };

    map.on('mousemove', aoMoverMouse);
    map.on('click', aoClicarMapa);
    map.on('zoomend moveend resize', aoMudarMapa);

    map.getContainer().addEventListener(
      'mouseleave',
      aoSairMapa
    );

    // BOTÃO PARA LIMPAR AS ÁREAS REVELADAS
    const controle = new L.Control({
      position: 'topright'
    });

    const botao = L.DomUtil.create(
      'button',
      'leaflet-bar'
    ) as HTMLButtonElement;

    botao.type = 'button';
    botao.textContent = 'Limpar aquarela';
    botao.title = 'Remover as áreas reveladas';

    botao.style.cssText = `
  background: white;
  border: 1px solid #DCE8F3;
  border-radius: 9px;
  padding: 10px 13px;
  font-size: 12px;
  font-weight: 700;
  color: #214563;
  cursor: pointer;
  box-shadow: 0 3px 12px rgba(0,0,0,0.1);
`;

    L.DomEvent.disableClickPropagation(botao);

    botao.addEventListener('click', evento => {
      evento.preventDefault();
      evento.stopPropagation();

      areasPintadas.length = 0;
      janelaAtual = null;

      atualizarAquarela();
    });

    controle.onAdd = () => botao;
    controle.addTo(map);

    // Configuração inicial.
    atualizarAquarela();

    // LIMPEZA DOS EVENTOS
    return () => {
      map.off('mousemove', aoMoverMouse);
      map.off('click', aoClicarMapa);
      map.off('zoomend moveend resize', aoMudarMapa);

      map.getContainer().removeEventListener(
        'mouseleave',
        aoSairMapa
      );

      controle.remove();
      map.removeLayer(camada);
    };

  }, [map, pontos, poligonosCeara, gradeLocalDisponivel]);

  return null;
}

// Cada polígono contém anéis de coordenadas [longitude, latitude].
type PoligonosCeara = number[][][][];


const RAIO_AJUSTE_CUIDAI_METROS = 500;

// Consulta a temperatura interpolada da grade Open-Meteo.
// A grade possui 5 linhas e 6 colunas.

function estimarTemperaturaNaGrade(
  pontos: PontoGradeTermica[],
  latitude: number,
  longitude: number
): number | null {

  if (
    pontos.length !== TOTAL_PONTOS_GRADE_TERMICA
  ) {
    return null;
  }

  const limites = LIMITES_GRADE_TERMICA;

  if (
    latitude < limites.sul ||
    latitude > limites.norte ||
    longitude < limites.oeste ||
    longitude > limites.leste
  ) {
    return null;
  }

  const posicaoY =
    ((limites.norte - latitude) /
      (limites.norte - limites.sul)) *
    (LINHAS_GRADE_TERMICA - 1);

  const posicaoX =
    ((longitude - limites.oeste) /
      (limites.leste - limites.oeste)) *
    (COLUNAS_GRADE_TERMICA - 1);

  return interpolarTemperaturaCurva(
    pontos,
    posicaoY,
    posicaoX
  );
}


function CamadaTemperaturaLocal({
  pontos,
  poligonosCeara
}: {
  pontos: PontoGradeLocal[];
  poligonosCeara: PoligonosCeara;
}) {
  const map = useMap();
  const [zoom, setZoom] = useState(map.getZoom());

  useEffect(() => {
    const atualizarZoom = () => setZoom(map.getZoom());

    map.on('zoomend', atualizarZoom);

    return () => {
      map.off('zoomend', atualizarZoom);
    };
  }, [map]);

  useEffect(() => {
    if (
      zoom < 10 ||
      pontos.length !== 25 ||
      poligonosCeara.length === 0
    ) {
      return;
    }

    // A consulta local possui 5 linhas e 5 colunas.
    const sul = pontos[0].latitude;
    const norte = pontos[24].latitude;
    const oeste = pontos[0].longitude;
    const leste = pontos[24].longitude;

    const largura = 480;
    const altura = 480;

    const canvas = document.createElement('canvas');
    canvas.width = largura;
    canvas.height = altura;

    const contexto = canvas.getContext('2d');
    if (!contexto) return;

    const imagem = contexto.createImageData(
      largura,
      altura
    );

    for (let y = 0; y < altura; y++) {
      for (let x = 0; x < largura; x++) {
        // A primeira linha da consulta é a mais ao sul.
        const posicaoLinha =
          (1 - y / (altura - 1)) * 4;

        const posicaoColuna =
          (x / (largura - 1)) * 4;

        const linha = Math.min(
          3,
          Math.floor(posicaoLinha)
        );

        const coluna = Math.min(
          3,
          Math.floor(posicaoColuna)
        );

        const fy = posicaoLinha - linha;
        const fx = posicaoColuna - coluna;

        const t00 =
          pontos[linha * 5 + coluna].temperatura;

        const t01 =
          pontos[linha * 5 + coluna + 1].temperatura;

        const t10 =
          pontos[(linha + 1) * 5 + coluna].temperatura;

        const t11 =
          pontos[(linha + 1) * 5 + coluna + 1]
            .temperatura;

        const superior =
          t00 * (1 - fx) + t01 * fx;

        const inferior =
          t10 * (1 - fx) + t11 * fx;

        const temperatura =
          superior * (1 - fy) + inferior * fy;

        // Utiliza a mesma paleta HEX do mapa regional.
        const cor = corTemperatura(
          temperatura,
          0,
          0
        );

        const indice = (y * largura + x) * 4;

        imagem.data[indice] = cor[0];
        imagem.data[indice + 1] = cor[1];
        imagem.data[indice + 2] = cor[2];
        imagem.data[indice + 3] = 255;
      }
    }

    contexto.putImageData(imagem, 0, 0);

    // Recorta a nova camada pelo contorno do Ceará.
    contexto.save();
    contexto.globalCompositeOperation = 'destination-in';
    contexto.fillStyle = '#000000';
    contexto.beginPath();

    for (const poligono of poligonosCeara) {
      for (const anel of poligono) {
        anel.forEach(([longitude, latitude], indice) => {
          const px =
            ((longitude - oeste) / (leste - oeste)) *
            (largura - 1);

          const py =
            ((norte - latitude) / (norte - sul)) *
            (altura - 1);

          if (indice === 0) {
            contexto.moveTo(px, py);
          } else {
            contexto.lineTo(px, py);
          }
        });

        contexto.closePath();
      }
    }

    contexto.fill('evenodd');
    contexto.restore();

    const camada = L.imageOverlay(
      canvas.toDataURL('image/png'),
      [
        [sul, oeste],
        [norte, leste]
      ],
      {
        opacity: zoom >= 13 ? 0.18 : 0.58,
        interactive: false
      }
    );

    camada.addTo(map);

    return () => {
      map.removeLayer(camada);
    };
  }, [map, zoom, pontos, poligonosCeara]);

  return null;
}


// CAMADA DE AJUSTE LOCAL DAS ESTAÇÕES CUIDAÍ
function CamadaAjusteLocalCuidai({
  pontos,
  estacoes
}: {
  pontos: PontoGradeTermica[];
  estacoes: EstacaoMeteo[];
}) {
  const map = useMap();

  useEffect(() => {
    if (
      pontos.length !== TOTAL_PONTOS_GRADE_TERMICA ||
      estacoes.length === 0
    ) {
      return;
    }

    const { minimo, maximo } = obterEscalaTermica(pontos);
    const camadas: L.Layer[] = [];
    const raio = RAIO_AJUSTE_CUIDAI_METROS;
    const tamanho = 160;

    for (const estacao of estacoes) {
      const leitura = estacao.ultimaLeitura;

      if (!leitura) continue;

      const modeloNaEstacao = estimarTemperaturaNaGrade(
        pontos,
        estacao.latitude,
        estacao.longitude
      );

      if (modeloNaEstacao === null) continue;

      // Diferença entre medição local e estimativa regional.
      const diferenca =
        leitura.temperatura - modeloNaEstacao;

      // Converte 500 metros em limites geográficos.
      const latitudeRad =
        estacao.latitude * Math.PI / 180;

      const deltaLat = raio / 111320;
      const deltaLon =
        raio /
        (111320 * Math.max(0.2, Math.cos(latitudeRad)));

      const canvas = document.createElement('canvas');
      canvas.width = tamanho;
      canvas.height = tamanho;

      const contexto = canvas.getContext('2d');
      if (!contexto) continue;

      const imagem = contexto.createImageData(
        tamanho,
        tamanho
      );

      for (let y = 0; y < tamanho; y++) {
        const latitude =
          estacao.latitude +
          deltaLat * (1 - 2 * y / (tamanho - 1));

        for (let x = 0; x < tamanho; x++) {
          const longitude =
            estacao.longitude +
            deltaLon * (2 * x / (tamanho - 1) - 1);

          const distanciaLat =
            (latitude - estacao.latitude) * 111320;

          const distanciaLon =
            (longitude - estacao.longitude) *
            111320 * Math.cos(latitudeRad);

          const distancia = Math.sqrt(
            distanciaLat ** 2 + distanciaLon ** 2
          );

          if (distancia >= raio) continue;

          const proporcao = distancia / raio;

          // Influência máxima no sensor e zero aos 500 m.
          const peso = Math.pow(
            1 - proporcao * proporcao,
            2
          );

          const temperaturaRegional =
            estimarTemperaturaNaGrade(
              pontos,
              latitude,
              longitude
            );

          if (temperaturaRegional === null) continue;

          const temperaturaAjustada =
            temperaturaRegional + diferenca * peso;

          const cor = corTemperatura(
            temperaturaAjustada,
            minimo,
            maximo
          );

          const indice = (y * tamanho + x) * 4;

          imagem.data[indice] = cor[0];
          imagem.data[indice + 1] = cor[1];
          imagem.data[indice + 2] = cor[2];

          // Transparência para preservar detalhes do mapa.
          imagem.data[indice + 3] =
            Math.round(125 * peso);
        }
      }

      contexto.putImageData(imagem, 0, 0);

      const camada = L.imageOverlay(
        canvas.toDataURL('image/png'),
        [
          [
            estacao.latitude - deltaLat,
            estacao.longitude - deltaLon
          ],
          [
            estacao.latitude + deltaLat,
            estacao.longitude + deltaLon
          ]
        ],
        {
          opacity: 1,
          interactive: false
        }
      );

      camada.addTo(map);
      camadas.push(camada);

      // Contorno discreto do raio experimental.
      const contorno = L.circle(
        [estacao.latitude, estacao.longitude],
        {
          radius: raio,
          color: '#168FC4',
          weight: 1,
          opacity: 0.6,
          dashArray: '4 5',
          fillOpacity: 0,
          interactive: false
        }
      );

      contorno.addTo(map);
      camadas.push(contorno);
    }

    return () => {
      camadas.forEach(camada => {
        map.removeLayer(camada);
      });
    };
  }, [map, pontos, estacoes]);

  return null;
}


type MunicipioFoco = {
  codigo: string;
  nome: string;
};

function CamadaMunicipiosCuidai({
  dados,
  selecionado,
  onSelecionar
}: {
  dados: FeatureCollection;
  selecionado: MunicipioFoco | null;
  onSelecionar: (
    municipio: MunicipioFoco,
    latitude: number,
    longitude: number
  ) => void;
}) {
  const map = useMap();

  const estiloMunicipio = (
    feature?: Feature
  ): L.PathOptions => {
    const ativo =
      String(feature?.properties?.id) ===
      selecionado?.codigo;

    return {
      color: ativo ? '#087CDB' : '#93A8B9',
      weight: ativo ? 3 : 0.9,
      opacity: ativo ? 1 : 0.65,
      fillColor: ativo ? '#168FC4' : '#FFFFFF',
      fillOpacity: ativo
        ? 0.24
        : selecionado
          ? 0.35
          : 0.02,
      bubblingMouseEvents: false
    };
  };

  return (
    <Pane
      name="territorios-cuidai"
      style={{ zIndex: 430 }}
    >
      <GeoJSON
        key={selecionado?.codigo ?? 'visao-geral'}
        data={dados}
        pane="territorios-cuidai"
        style={estiloMunicipio}
        onEachFeature={(feature, layer) => {
          const codigo = String(
            feature.properties?.id ?? ''
          );

          const nome = String(
            feature.properties?.name ?? ''
          );

          if (!codigo || !nome) return;

          const caminho = layer as L.Path;

          layer.bindTooltip(nome, {
            sticky: true,
            direction: 'top'
          });

          layer.on('mouseover', () => {
            if (codigo !== selecionado?.codigo) {
              caminho.setStyle({
                color: '#168FC4',
                weight: 2.5,
                opacity: 1,
                fillOpacity: 0.15
              });
            }
          });

          layer.on('mouseout', () => {
            caminho.setStyle(estiloMunicipio(feature));
          });

          layer.on('click', evento => {
            const clique = evento as L.LeafletMouseEvent;

            onSelecionar(
              { codigo, nome },
              Number(clique.latlng.lat.toFixed(4)),
              Number(clique.latlng.lng.toFixed(4))
            );

            const poligono = layer as L.Polygon;

            map.flyToBounds(poligono.getBounds(), {
              padding: [30, 30],
              maxZoom: 10,
              duration: 0.7
            });
          });
        }}
      />
    </Pane>
  );
}


// PERMITE SELECIONAR UM PONTO NO MAPA
function SelecionarPontoOpenMeteo({
  onSelecionar
}: {
  onSelecionar: (latitude: number, longitude: number) => void;
}) {
  useMapEvents({
    click(evento) {
      onSelecionar(
        Number(evento.latlng.lat.toFixed(4)),
        Number(evento.latlng.lng.toFixed(4))
      );
    }
  });

  return null;
}

function PaginaBaixar() {
  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#F2F2F7',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'center',
        padding: '24px',
        boxSizing: 'border-box'
      }}
    >
      <div
        style={{
          width: '100%',
          maxWidth: '430px',
          backgroundColor: '#fff',
          borderRadius: '28px',
          padding: '32px 24px',
          boxShadow: '0 12px 40px rgba(0,0,0,0.08)',
          textAlign: 'center'
        }}
      >

        <img
          src="/logonovoapp.png"
          alt="Cuidaí"
          style={{
            width: '105px',
            height: '105px',
            objectFit: 'contain',
            marginBottom: '12px'
          }}
        />

        <h1
          style={{
            margin: 0,
            fontSize: '29px',
            color: '#1C1C1E'
          }}
        >
          Baixe o CUIDAÍ App
        </h1>

        <p
          style={{
            color: '#6E6E73',
            fontSize: '14px',
            lineHeight: '21px',
            margin: '10px 0 28px'
          }}
        >
          Informação compartilhada para cuidar de quem vive no Sertão.
        </p>

        {/* ANDROID */}
        <a
          href="https://github.com/Bluequation/cuidai-download/releases/download/v1.0.1/Cuidai-1.0.1.apk"
          style={{
            display: 'block',
            backgroundColor: '#F7F8FA',
            borderRadius: '18px',
            padding: '18px',
            marginBottom: '14px',
            textAlign: 'left',
            textDecoration: 'none',
            cursor: 'pointer'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px'
            }}
          >
            <div
              style={{
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <FaAndroid size={30} color="#3DDC84" />
            </div>

            <div style={{ flex: 1 }}>
              <strong
                style={{
                  display: 'block',
                  color: '#1C1C1E',
                  fontSize: '16px'
                }}
              >
                Android
              </strong>

              <span
                style={{
                  color: '#8E8E93',
                  fontSize: '13px'
                }}
              >
                Versão 1.0.1
              </span>
            </div>

            <span
              style={{
                backgroundColor: '#E8F4FA',
                color: '#168FC4',
                padding: '7px 10px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: '700'
              }}
            >
              BAIXAR APK
            </span>
          </div>
        </a>

        {/* IOS */}
        <div
          style={{
            backgroundColor: '#F7F8FA',
            borderRadius: '18px',
            padding: '18px',
            textAlign: 'left'
          }}
        >
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '14px'
            }}
          >
            <div
              style={{
                width: '38px',
                height: '38px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <FaApple size={30} color="#1C1C1E" />
            </div>

            <div style={{ flex: 1 }}>
              <strong
                style={{
                  display: 'block',
                  color: '#1C1C1E',
                  fontSize: '16px'
                }}
              >
                iPhone
              </strong>

              <span
                style={{
                  color: '#8E8E93',
                  fontSize: '13px'
                }}
              >
                Versão para iOS
              </span>
            </div>

            <span
              style={{
                backgroundColor: '#F0F0F2',
                color: '#6E6E73',
                padding: '7px 10px',
                borderRadius: '20px',
                fontSize: '11px',
                fontWeight: '700'
              }}
            >
              EM BREVE
            </span>
          </div>
        </div>

        <button
          onClick={() => window.location.href = '/'}
          style={{
            marginTop: '26px',
            border: 'none',
            background: 'transparent',
            color: '#168FC4',
            fontWeight: '700',
            cursor: 'pointer',
            fontSize: '13px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '5px',
            lineHeight: 1
          }}
        >
          <MdArrowBack
            size={16}
            style={{ display: 'block' }}
          />

          <span>
            Ir para o Cuidaí Painel
          </span>
        </button>

      </div>
    </div>
  );
}

function App() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [estacoesMeteo, setEstacoesMeteo] = useState<EstacaoMeteo[]>([]);
  const [carregandoMeteo, setCarregandoMeteo] = useState(true);
  const [erroMeteo, setErroMeteo] = useState<string | null>(null);
  const [idEstacaoMeteo, setIdEstacaoMeteo] = useState<string | null>(null);
  const [agoraMeteo, setAgoraMeteo] = useState(Date.now());
  // PONTO SELECIONADO PARA CONSULTA OPEN-METEO
  const [pontoOpenMeteo, setPontoOpenMeteo] = useState({
    latitude: -5.3,
    longitude: -39.3
  });

  const [dadosOpenMeteo, setDadosOpenMeteo] =
    useState<DadosOpenMeteo | null>(null);

  const [carregandoOpenMeteo, setCarregandoOpenMeteo] =
    useState(false);

  const [erroOpenMeteo, setErroOpenMeteo] =
    useState<string | null>(null);

  const [pontosGradeLocal, setPontosGradeLocal] =
    useState<PontoGradeLocal[]>([]);

  const [amplitudeLocalMeteo, setAmplitudeLocalMeteo] =
    useState<{
      minimo: number;
      maximo: number;
      quantidade: number;
    } | null>(null);

  const [carregandoAmplitudeLocal, setCarregandoAmplitudeLocal] =
    useState(false);

  const [erroAmplitudeLocal, setErroAmplitudeLocal] =
    useState<string | null>(null);

  const [pontosGradeTermica, setPontosGradeTermica] =
    useState<PontoGradeTermica[]>([]);

  const [carregandoGradeTermica, setCarregandoGradeTermica] =
    useState(false);

  const [erroGradeTermica, setErroGradeTermica] =
    useState<string | null>(null);

  const [mostrarGradeTermica, setMostrarGradeTermica] =
    useState(false);

  const [poligonosCeara, setPoligonosCeara] =
    useState<PoligonosCeara>([]);

  const [municipiosGeoJson, setMunicipiosGeoJson] =
    useState<FeatureCollection | null>(null);

  const [municipioSelecionado, setMunicipioSelecionado] =
    useState<MunicipioFoco | null>(null);

  const [erroContornoCeara, setErroContornoCeara] =
    useState<string | null>(null);

  // Evita repetir a consulta ao mudar de página.
  // O cache vale por 30 minutos enquanto o painel estiver aberto.
  const cacheGradeTermica = useRef<{
    pontos: PontoGradeTermica[];
    atualizadoEm: number;
  } | null>(null);

  const [historicoMeteo, setHistoricoMeteo] =
    useState<LeituraHistoricaMeteo[]>([]);

  const [carregandoHistoricoMeteo, setCarregandoHistoricoMeteo] =
    useState(true);

  const [erroHistoricoMeteo, setErroHistoricoMeteo] =
    useState<string | null>(null);

  const idEstacaoHistoricoMeteo =
    estacoesMeteo.find(e => e.id === idEstacaoMeteo)?.id ??
    estacoesMeteo[0]?.id ??
    null;
  const [minhaLocalizacao, setMinhaLocalizacao] = useState<[number, number] | null>(null);
  const [carregamentoInicial, setCarregamentoInicial] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<'visao_geral' | 'mapa_calor' | 'meteorologia' | 'sobre'>('visao_geral');
  const [filtroCalor, setFiltroCalor] = useState<string>('Todas');
  const [filtroCategoria, setFiltroCategoria] = useState<string>('Todas');
  const [online, setOnline] = useState(navigator.onLine);  // 👇 ESTADOS PARA CONTROLAR A RESPONSIVIDADE E O MENU MOBILE
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [menuAberto, setMenuAberto] = useState(false);
  const [infoMapaCalorAberta, setInfoMapaCalorAberta] = useState(false);

  const [tecnologiaAtual, setTecnologiaAtual] = useState(0);

  const tecnologias = [
    {
      titulo: 'Aplicativo',
      descricao: 'React Native + Expo'
    },
    {
      titulo: 'Painel Web',
      descricao: 'React + TypeScript'
    },
    {
      titulo: 'Dados',
      descricao: 'Firebase Cloud Firestore'
    },
    {
      titulo: 'Mapas',
      descricao: 'Leaflet + React-Leaflet'
    },
    {
      titulo: 'Visualização de dados',
      descricao: 'Recharts + Leaflet.heat'
    }
  ];

  useEffect(() => {
    const intervaloTecnologias = setInterval(() => {
      setTecnologiaAtual((atual) =>
        (atual + 1) % tecnologias.length
      );
    }, 4000);

    return () => clearInterval(intervaloTecnologias);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      setCarregamentoInicial(false);
    }, 2000);

    return () => clearTimeout(timer);
  }, []);

  // Monitora o tamanho da tela em tempo real
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    const ficouOnline = () => setOnline(true);
    const ficouOffline = () => setOnline(false);

    window.addEventListener('online', ficouOnline);
    window.addEventListener('offline', ficouOffline);

    return () => {
      window.removeEventListener('online', ficouOnline);
      window.removeEventListener('offline', ficouOffline);
    };
  }, []);

  // LOCALIZAÇÃO INICIAL DO DISPOSITIVO
  useEffect(() => {
    const localizacaoPadrao: [number, number] = [-5.3, -39.3];

    if (!navigator.geolocation) {
      setMinhaLocalizacao(localizacaoPadrao);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (posicao) => {
        const latitude = Number(
          posicao.coords.latitude.toFixed(4)
        );

        const longitude = Number(
          posicao.coords.longitude.toFixed(4)
        );

        // Localização inicial dos mapas
        setMinhaLocalizacao([latitude, longitude]);

        // A consulta Open-Meteo começa na mesma região
        setPontoOpenMeteo({
          latitude,
          longitude
        });
      },
      () => {
        // Se o usuário não autorizar a localização,
        // o painel utiliza uma referência regional.
        setMinhaLocalizacao(localizacaoPadrao);
      },
      {
        enableHighAccuracy: false,
        timeout: 12000,
        maximumAge: 60000
      }
    );
  }, []);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'alertas'), (snapshot) => {
      const lista: Alerta[] = [];
      snapshot.forEach((doc) => {
        const dados = doc.data();
        if (dados.coordenada && dados.coordenada.latitude) {
          const mmTitulo = dados.titulo?.match(/\(([\d.,]+)mm\)/i);

          lista.push({
            id: doc.id,
            latitude: dados.coordenada.latitude,
            longitude: dados.coordenada.longitude,
            categoria: dados.categoria || 'Sem categoria',
            titulo: dados.titulo || 'Sem título',
            detalhe: dados.detalhe,
            hora: dados.hora || '--:--',
            criadoEm: dados.criadoEm || 0,
            milimetrosChuva: dados.milimetrosChuva ?? (mmTitulo ? Number(mmTitulo[1].replace(',', '.')) : undefined),
            votosConfirma: dados.votosConfirma || 0,
            votosResolvido: dados.votosResolvido || 0,
            autor: dados.autor,
            temFoto: dados.temFoto || false,
            fotoUrl: dados.fotoUrl,
          });
        }
      });
      setAlertas(lista);
    });
    return () => unsubscribe();
  }, []);

  // ESTAÇÕES METEOROLÓGICAS PUBLICADAS
  useEffect(() => {
    const consulta = query(
      collection(db, 'estacoesMeteorologicas'),
      where('publicada', '==', true),
      limit(50)
    );

    const unsubscribe = onSnapshot(
      consulta,
      (snapshot) => {
        const lista: EstacaoMeteo[] = [];

        snapshot.forEach((documento) => {
          const dados = documento.data();

          const latitude = dados.latitude;
          const longitude = dados.longitude;

          if (
            typeof latitude !== 'number' ||
            typeof longitude !== 'number' ||
            !Number.isFinite(latitude) ||
            !Number.isFinite(longitude) ||
            Math.abs(latitude) > 90 ||
            Math.abs(longitude) > 180
          ) {
            return;
          }

          const leitura = dados.ultimaLeitura;

          const recebidoEm =
            typeof leitura?.recebidoEm?.toMillis === 'function'
              ? leitura.recebidoEm.toMillis()
              : leitura?.recebidoEm;

          const leituraValida =
            typeof leitura?.temperatura === 'number' &&
            Number.isFinite(leitura.temperatura) &&
            leitura.temperatura >= -50 &&
            leitura.temperatura <= 70 &&
            typeof leitura?.umidade === 'number' &&
            Number.isFinite(leitura.umidade) &&
            leitura.umidade >= 0 &&
            leitura.umidade <= 100 &&
            typeof recebidoEm === 'number' &&
            Number.isFinite(recebidoEm) &&
            recebidoEm > 0 &&
            recebidoEm <= Date.now() + 5 * 60 * 1000;

          lista.push({
            id: documento.id,
            nome: typeof dados.nome === 'string'
              ? dados.nome
              : 'Estação CUIDAÍ',
            municipio: typeof dados.municipio === 'string'
              ? dados.municipio
              : 'Não informado',
            latitude,
            longitude,
            experimental: dados.experimental === true,
            ultimaLeitura: leituraValida
              ? {
                temperatura: leitura.temperatura,
                umidade: leitura.umidade,
                recebidoEm
              }
              : null
          });
        });

        setEstacoesMeteo(lista);
        setCarregandoMeteo(false);
        setErroMeteo(null);
      },
      (erro) => {
        console.error('Erro nas estações:', erro);
        setErroMeteo('Não foi possível consultar as estações.');
        setCarregandoMeteo(false);
      }
    );

    return () => unsubscribe();
  }, []);

  // Atualiza a verificação de leituras recentes a cada minuto
  useEffect(() => {
    const intervalo = window.setInterval(() => {
      setAgoraMeteo(Date.now());
    }, 60000);

    return () => window.clearInterval(intervalo);
  }, []);

  // HISTÓRICO DA ESTAÇÃO METEOROLÓGICA SELECIONADA
  useEffect(() => {
    setHistoricoMeteo([]);
    setErroHistoricoMeteo(null);

    if (!idEstacaoHistoricoMeteo) {
      setCarregandoHistoricoMeteo(false);
      return;
    }

    setCarregandoHistoricoMeteo(true);

    const consulta = query(
      collection(
        db,
        'estacoesMeteorologicas',
        idEstacaoHistoricoMeteo,
        'leituras'
      ),
      orderBy('recebidoEm', 'desc'),
      limit(72)
    );

    const unsubscribe = onSnapshot(
      consulta,
      (snapshot) => {
        const lista: LeituraHistoricaMeteo[] = [];

        snapshot.forEach((documento) => {
          const dados = documento.data();

          const recebidoEm =
            typeof dados.recebidoEm?.toMillis === 'function'
              ? dados.recebidoEm.toMillis()
              : dados.recebidoEm;

          if (
            typeof dados.temperatura !== 'number' ||
            !Number.isFinite(dados.temperatura) ||
            dados.temperatura < -50 ||
            dados.temperatura > 70 ||
            typeof dados.umidade !== 'number' ||
            !Number.isFinite(dados.umidade) ||
            dados.umidade < 0 ||
            dados.umidade > 100 ||
            typeof recebidoEm !== 'number' ||
            !Number.isFinite(recebidoEm) ||
            recebidoEm <= 0 ||
            recebidoEm > Date.now() + 300000
          ) {
            return;
          }

          lista.push({
            id: documento.id,
            temperatura: dados.temperatura,
            umidade: dados.umidade,
            recebidoEm,
            momento: new Date(recebidoEm).toLocaleString(
              'pt-BR',
              {
                day: '2-digit',
                month: '2-digit',
                hour: '2-digit',
                minute: '2-digit'
              }
            )
          });
        });

        lista.sort((a, b) => a.recebidoEm - b.recebidoEm);

        setHistoricoMeteo(lista);
        setErroHistoricoMeteo(null);
        setCarregandoHistoricoMeteo(false);
      },
      (erro) => {
        console.error('Erro no histórico meteorológico:', erro);
        setErroHistoricoMeteo(
          'Não foi possível consultar o histórico desta estação.'
        );
        setCarregandoHistoricoMeteo(false);
      }
    );

    return () => unsubscribe();
  }, [idEstacaoHistoricoMeteo]);

  // CONSULTA METEOROLÓGICA REGIONAL — OPEN-METEO
  useEffect(() => {
    if (abaAtiva !== 'meteorologia') return;

    const controlador = new AbortController();

    const consultar = async () => {
      setCarregandoOpenMeteo(true);
      setErroOpenMeteo(null);
      setDadosOpenMeteo(null);

      try {
        const parametros = new URLSearchParams({
          latitude: pontoOpenMeteo.latitude.toString(),
          longitude: pontoOpenMeteo.longitude.toString(),
          current:
            'temperature_2m,relative_humidity_2m,apparent_temperature,wind_speed_10m',
          timezone: 'America/Fortaleza',
          wind_speed_unit: 'kmh'
        });

        const resposta = await fetch(
          `https://api.open-meteo.com/v1/forecast?${parametros.toString()}`,
          { signal: controlador.signal }
        );

        if (!resposta.ok) {
          throw new Error(`Erro HTTP ${resposta.status}`);
        }

        const resultado = await resposta.json();
        const atual = resultado.current;

        const valores = [
          atual?.temperature_2m,
          atual?.relative_humidity_2m,
          atual?.apparent_temperature,
          atual?.wind_speed_10m
        ];

        if (
          !valores.every(
            valor =>
              typeof valor === 'number' &&
              Number.isFinite(valor)
          ) ||
          typeof atual?.time !== 'string'
        ) {
          throw new Error('Dados meteorológicos incompletos');
        }

        if (!controlador.signal.aborted) {
          setDadosOpenMeteo({
            temperatura: atual.temperature_2m,
            umidade: atual.relative_humidity_2m,
            sensacao: atual.apparent_temperature,
            vento: atual.wind_speed_10m,
            horario: atual.time
          });
        }
      } catch (erro) {
        if (!controlador.signal.aborted) {
          console.error('Erro na Open-Meteo:', erro);

          setErroOpenMeteo(
            'Não foi possível consultar os dados meteorológicos deste local.'
          );
        }
      } finally {
        if (!controlador.signal.aborted) {
          setCarregandoOpenMeteo(false);
        }
      }
    };

    consultar();

    return () => controlador.abort();
  }, [
    abaAtiva,
    pontoOpenMeteo.latitude,
    pontoOpenMeteo.longitude
  ]);
  // CARREGA OS LIMITES MUNICIPAIS DO CEARÁ
  useEffect(() => {
    const controlador = new AbortController();

    const carregarMunicipios = async () => {
      try {
        const resposta = await fetch(
          '/municipios-ceara.geojson',
          { signal: controlador.signal }
        );

        if (!resposta.ok) {
          throw new Error('Arquivo municipal não encontrado');
        }

        const dados =
          (await resposta.json()) as FeatureCollection;

        if (
          dados.type !== 'FeatureCollection' ||
          !Array.isArray(dados.features)
        ) {
          throw new Error('GeoJSON municipal inválido');
        }

        if (!controlador.signal.aborted) {
          setMunicipiosGeoJson(dados);
        }
      } catch (erro) {
        if (!controlador.signal.aborted) {
          console.error(
            'Erro ao carregar municípios:',
            erro
          );
        }
      }
    };

    carregarMunicipios();

    return () => controlador.abort();
  }, []);

  // CARREGA O CONTORNO DO CEARÁ SALVO NO PROJETO
  useEffect(() => {
    const controlador = new AbortController();

    const carregarContorno = async () => {
      try {
        const resposta = await fetch('/ceara.geojson', {
          signal: controlador.signal
        });

        if (!resposta.ok) {
          throw new Error('Arquivo geográfico não encontrado');
        }

        const geojson = await resposta.json();

        const geometria =
          geojson.type === 'FeatureCollection'
            ? geojson.features?.[0]?.geometry
            : geojson.type === 'Feature'
              ? geojson.geometry
              : geojson;

        let poligonos: PoligonosCeara;

        if (geometria?.type === 'MultiPolygon') {
          poligonos = geometria.coordinates;
        } else if (geometria?.type === 'Polygon') {
          poligonos = [geometria.coordinates];
        } else {
          throw new Error('Formato geográfico não reconhecido');
        }

        if (!Array.isArray(poligonos) || poligonos.length === 0) {
          throw new Error('Contorno estadual vazio');
        }

        if (!controlador.signal.aborted) {
          setPoligonosCeara(poligonos);
          setErroContornoCeara(null);
        }
      } catch (erro) {
        if (!controlador.signal.aborted) {
          console.error('Erro no contorno do Ceará:', erro);
          setErroContornoCeara(
            'Não foi possível carregar o contorno do Ceará.'
          );
        }
      }
    };

    carregarContorno();

    return () => controlador.abort();
  }, []);

  // GRADE REGIONAL DE TEMPERATURA — OPEN-METEO
  useEffect(() => {
    if (abaAtiva !== 'meteorologia') return;

    const cache = cacheGradeTermica.current;

    if (
      cache &&
      Date.now() - cache.atualizadoEm < 30 * 60 * 1000
    ) {
      setPontosGradeTermica(cache.pontos);
      setCarregandoGradeTermica(false);
      return;
    }

    const controlador = new AbortController();

    const consultarGrade = async () => {
      setCarregandoGradeTermica(true);
      setErroGradeTermica(null);

      const limites = LIMITES_GRADE_TERMICA;
      const coordenadas: {
        latitude: number;
        longitude: number;
      }[] = [];

      // Grade regional de 9 linhas por 11 colunas.
      for (
        let linha = 0;
        linha < LINHAS_GRADE_TERMICA;
        linha++
      ) {
        for (
          let coluna = 0;
          coluna < COLUNAS_GRADE_TERMICA;
          coluna++
        ) {
          coordenadas.push({
            latitude:
              limites.norte -
              (
                linha / (LINHAS_GRADE_TERMICA - 1)
              ) * (limites.norte - limites.sul),

            longitude:
              limites.oeste +
              (
                coluna / (COLUNAS_GRADE_TERMICA - 1)
              ) * (limites.leste - limites.oeste)
          });
        }
      }

      try {
        const parametros = new URLSearchParams({
          latitude: coordenadas
            .map(ponto => ponto.latitude.toFixed(4))
            .join(','),
          longitude: coordenadas
            .map(ponto => ponto.longitude.toFixed(4))
            .join(','),
          current: 'temperature_2m',
          timezone: 'America/Fortaleza',
          timeformat: 'unixtime'
        });

        const resposta = await fetch(
          `https://api.open-meteo.com/v1/forecast?${parametros.toString()}`,
          { signal: controlador.signal }
        );

        if (!resposta.ok) {
          throw new Error(`HTTP ${resposta.status}`);
        }

        const resultados = await resposta.json();

        if (
          !Array.isArray(resultados) ||
          resultados.length !== coordenadas.length
        ) {
          throw new Error('Grade meteorológica incompleta');
        }

        const pontos: PontoGradeTermica[] =
          resultados.map((resultado, indice) => {
            const temperatura =
              resultado?.current?.temperature_2m;

            if (
              typeof temperatura !== 'number' ||
              !Number.isFinite(temperatura) ||
              temperatura < -50 ||
              temperatura > 60
            ) {
              throw new Error('Temperatura inválida na grade');
            }

            const horarioModelo = resultado?.current?.time;

            if (
              typeof horarioModelo !== 'number' ||
              !Number.isFinite(horarioModelo)
            ) {
              throw new Error('Horário meteorológico inválido');
            }

            return {
              ...coordenadas[indice],
              temperatura,
              horarioModelo: horarioModelo * 1000
            };
          });

        if (!controlador.signal.aborted) {
          setPontosGradeTermica(pontos);

          cacheGradeTermica.current = {
            pontos,
            atualizadoEm: Date.now()
          };
        }
      } catch (erro) {
        if (!controlador.signal.aborted) {
          console.error('Erro na grade Open-Meteo:', erro);

          setErroGradeTermica(
            'Não foi possível carregar a camada de temperaturas.'
          );
          setPontosGradeTermica([]);
        }
      } finally {
        if (!controlador.signal.aborted) {
          setCarregandoGradeTermica(false);
        }
      }
    };

    consultarGrade();

    return () => controlador.abort();
  }, [abaAtiva]);


  // ANÁLISE LOCAL — 25 PONTOS OPEN-METEO
  useEffect(() => {
    if (abaAtiva !== 'meteorologia') return;

    const controlador = new AbortController();

    const consultarAreaLocal = async () => {
      setCarregandoAmplitudeLocal(true);
      setErroAmplitudeLocal(null);
      setAmplitudeLocalMeteo(null);
      setPontosGradeLocal([]);

      // Amostragem aproximada em uma área de
      // 45 km x 45 km ao redor do ponto selecionado.
      const coordenadas: {
        latitude: number;
        longitude: number;
      }[] = [];

      for (let linha = 0; linha < 5; linha++) {
        for (let coluna = 0; coluna < 5; coluna++) {
          coordenadas.push({
            latitude:
              pontoOpenMeteo.latitude + (linha - 2) * 0.1,
            longitude:
              pontoOpenMeteo.longitude + (coluna - 2) * 0.1
          });
        }
      }

      try {
        const parametros = new URLSearchParams({
          latitude: coordenadas
            .map(p => p.latitude.toFixed(4))
            .join(','),
          longitude: coordenadas
            .map(p => p.longitude.toFixed(4))
            .join(','),
          current: 'temperature_2m',
          timezone: 'America/Fortaleza',
          forecast_days: '1'
        });

        const resposta = await fetch(
          `https://api.open-meteo.com/v1/forecast?${parametros}`,
          { signal: controlador.signal }
        );

        if (!resposta.ok) {
          throw new Error(`HTTP ${resposta.status}`);
        }

        const resultados = await resposta.json();

        if (
          !Array.isArray(resultados) ||
          resultados.length !== coordenadas.length
        ) {
          throw new Error('Resposta local incompleta');
        }

        const temperaturas = resultados.map(resultado => {
          const valor = resultado?.current?.temperature_2m;

          if (
            typeof valor !== 'number' ||
            !Number.isFinite(valor)
          ) {
            throw new Error('Temperatura local inválida');
          }

          return valor as number;
        });

        if (!controlador.signal.aborted) {
          setPontosGradeLocal(
            coordenadas.map((coordenada, indice) => ({
              ...coordenada,
              temperatura: temperaturas[indice]
            }))
          );
          setAmplitudeLocalMeteo({
            minimo: Math.min(...temperaturas),
            maximo: Math.max(...temperaturas),
            quantidade: temperaturas.length
          });
        }
      } catch (erro) {
        if (!controlador.signal.aborted) {
          console.error('Erro na análise local:', erro);
          setErroAmplitudeLocal(
            'Não foi possível consultar a grade local.'
          );
        }
      } finally {
        if (!controlador.signal.aborted) {
          setCarregandoAmplitudeLocal(false);
        }
      }
    };

    // Evita disparar imediatamente uma consulta a cada clique.
    const espera = window.setTimeout(consultarAreaLocal, 600);

    return () => {
      window.clearTimeout(espera);
      controlador.abort();
    };
  }, [
    abaAtiva,
    pontoOpenMeteo.latitude,
    pontoOpenMeteo.longitude
  ]);


  const exportarDados = () => {
    if (alertas.length === 0) return;

    const limpar = (valor: any) => {
      const texto = valor === undefined || valor === null ? '' : String(valor);
      return `"${texto.replace(/"/g, '""')}"`;
    };

    const cabecalho = [
      'ID',
      'Data',
      'Hora',
      'Categoria',
      'Detalhe',
      'Pluviometria (mm)',
      'Status',
      'Confirmacoes',
      'Votos de resolucao',
      'Autor',
      'Possui foto',
      'Foto',
      'Latitude',
      'Longitude'
    ];

    const linhas = alertas.map(alerta => {
      const data = alerta.criadoEm
        ? new Date(alerta.criadoEm).toLocaleDateString('pt-BR')
        : '';

      const status = (alerta.votosResolvido || 0) >= 3
        ? 'Resolvido'
        : 'Ativo';

      return [
        limpar(alerta.id),
        limpar(data),
        limpar(alerta.hora),
        limpar(alerta.categoria),
        limpar(alerta.detalhe || alerta.titulo),
        limpar(
          typeof alerta.milimetrosChuva === 'number'
            ? alerta.milimetrosChuva.toString().replace('.', ',')
            : ''
        ),
        limpar(status),
        limpar(alerta.votosConfirma || 0),
        limpar(alerta.votosResolvido || 0),
        limpar(alerta.autor || ''),
        limpar(alerta.fotoUrl ? 'Sim' : 'Nao'),
        limpar(alerta.fotoUrl || ''),
        limpar(alerta.latitude.toString().replace('.', ',')),
        limpar(alerta.longitude.toString().replace('.', ','))
      ].join(';');
    });

    const csvContent = '\uFEFF' + [
      cabecalho.join(';'),
      ...linhas
    ].join('\n');

    const blob = new Blob(
      [csvContent],
      { type: 'text/csv;charset=utf-8;' }
    );

    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');

    link.href = url;
    link.download = `relatorio_cuidai_${new Date().getTime()}.csv`;

    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    URL.revokeObjectURL(url);
  };

  const alertasVisaoGeral = filtroCategoria === 'Todas'
    ? alertas
    : alertas.filter(a => a.categoria === filtroCategoria);

  const alertasAtivosVisao = alertasVisaoGeral.filter(a => (a.votosResolvido || 0) < 3);
  const alertasResolvidosVisao = alertasVisaoGeral.filter(a => (a.votosResolvido || 0) >= 3);

  const alertasPorCategoria = alertasVisaoGeral.reduce((acc: any, alerta) => {
    acc[alerta.categoria] = (acc[alerta.categoria] || 0) + 1;
    return acc;
  }, {});

  const dadosGrafico = Object.keys(alertasPorCategoria).map((chave) => ({
    nome: chave, quantidade: alertasPorCategoria[chave],
  }));

  const alertasPorDia = alertasVisaoGeral.reduce((acc: any, alerta) => {
    if (alerta.criadoEm) {
      const d = new Date(alerta.criadoEm);
      const chave = `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;

      if (!acc[chave]) {
        acc[chave] = {
          data: d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }),
          ocorrencias: 0,
          timestamp: new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
        };
      }

      acc[chave].ocorrencias++;
    }

    return acc;
  }, {});

  const dadosLinhaTempo = Object.values(alertasPorDia)
    .sort((a: any, b: any) => a.timestamp - b.timestamp);

  const alertasComPluviometro = alertasVisaoGeral.filter(a =>
    typeof a.milimetrosChuva === 'number' && Number.isFinite(a.milimetrosChuva)
  );

  const mediaPluviometria = alertasComPluviometro.length
    ? alertasComPluviometro.reduce((s, a) => s + (a.milimetrosChuva || 0), 0) / alertasComPluviometro.length
    : 0;

  const maiorPluviometria = alertasComPluviometro.length
    ? Math.max(...alertasComPluviometro.map(a => a.milimetrosChuva || 0))
    : 0;

  const dadosPluviometriaRecente = alertas
    .filter(a =>
      typeof a.milimetrosChuva === 'number' &&
      Number.isFinite(a.milimetrosChuva)
    )
    .sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0))
    .slice(0, 8)
    .reverse()
    .map((a) => ({
      valor: a.milimetrosChuva || 0,
      momento: a.criadoEm
        ? new Date(a.criadoEm).toLocaleDateString('pt-BR', {
          day: '2-digit',
          month: '2-digit'
        })
        : a.hora || ''
    }));

  const alertasAtivos = alertas.filter(a => (a.votosResolvido || 0) < 3);

  const alertasRecentes = [...alertasVisaoGeral].sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  const categoriasUnicas = Array.from(new Set(alertasAtivos.map(a => a.categoria)));

  const alertasParaOMapa = filtroCalor === 'Todas'
    ? alertasAtivos
    : alertasAtivos.filter(a => a.categoria === filtroCalor);
  const gradienteAtual = getGradiente(filtroCalor);

  const valoresOrdenados = Object.entries(gradienteAtual).sort((a, b) => Number(a[0]) - Number(b[0])).map(item => item[1]);
  const coresLegenda = Array.from(new Set(valoresOrdenados));

  const cssLegenda = `linear-gradient(to right, ${coresLegenda[0]} 0%, ${coresLegenda[0]} 20%, ${coresLegenda[1]} 20%, ${coresLegenda[1]} 40%, ${coresLegenda[2]} 40%, ${coresLegenda[2]} 60%, ${coresLegenda[3]} 60%, ${coresLegenda[3]} 80%, ${coresLegenda[4]} 80%, ${coresLegenda[4]} 100%)`;

  const getCorCategoria = (nomeCategoria: string) => {
    const index = dadosGrafico.findIndex((item) => item.nome === nomeCategoria);
    return index !== -1 ? CORES[index % CORES.length] : '#007AFF';
  };

  const criarIconeVazado = (cor: string) => {
    return divIcon({
      className: '',
      html: `<div style="width: 16px; height: 16px; border-radius: 50%; border: 4px solid ${cor}; background-color: white; box-shadow: 0px 4px 8px rgba(0,0,0,0.2);"></div>`,
      iconSize: [24, 24], iconAnchor: [12, 12], popupAnchor: [0, -12]
    });
  };

  const estacaoSelecionadaMeteo =
    estacoesMeteo.find(e => e.id === idEstacaoMeteo) ??
    estacoesMeteo[0] ??
    null;

  const leituraSelecionadaMeteo =
    estacaoSelecionadaMeteo?.ultimaLeitura ?? null;

  const leituraRecenteMeteo =
    leituraSelecionadaMeteo !== null &&
    leituraSelecionadaMeteo.recebidoEm <= agoraMeteo &&
    agoraMeteo - leituraSelecionadaMeteo.recebidoEm <= 30 * 60 * 1000;

  const indicadoresMeteo = [
    {
      titulo: 'Temperatura',
      valor: leituraSelecionadaMeteo
        ? `${leituraSelecionadaMeteo.temperatura.toFixed(1)} °C`
        : '—',
      legenda: leituraSelecionadaMeteo
        ? leituraRecenteMeteo
          ? 'Medição recente da estação'
          : 'Última medição histórica'
        : 'Sem leitura disponível'
    },
    {
      titulo: 'Umidade',
      valor: leituraSelecionadaMeteo
        ? `${leituraSelecionadaMeteo.umidade.toFixed(0)}%`
        : '—',
      legenda: leituraRecenteMeteo
        ? 'Medição recente'
        : 'Sem medição recente'
    },
    {
      titulo: 'Estações CUIDAÍ',
      valor: carregandoMeteo || erroMeteo
        ? '—'
        : String(estacoesMeteo.length),
      legenda: carregandoMeteo
        ? 'Consultando Firebase'
        : erroMeteo
          ? 'Erro na consulta'
          : 'Estações publicadas'
    },
    {
      titulo: 'Última atualização',
      valor: leituraSelecionadaMeteo
        ? new Date(leituraSelecionadaMeteo.recebidoEm)
          .toLocaleTimeString('pt-BR', {
            hour: '2-digit',
            minute: '2-digit'
          })
        : '—',
      legenda: leituraSelecionadaMeteo
        ? new Date(leituraSelecionadaMeteo.recebidoEm)
          .toLocaleDateString('pt-BR')
        : 'Sem leitura disponível'
    }
  ];

  // ESTAÇÕES ELEGÍVEIS PARA O MAPA HÍBRIDO
  const horarioModeloHibrido =
    pontosGradeTermica[0]?.horarioModelo ?? 0;

  const estacoesAptasHibrido = estacoesMeteo.filter(
    (estacao) => {
      const leitura = estacao.ultimaLeitura;

      if (!leitura || !horarioModeloHibrido) {
        return false;
      }

      return (
        leitura.recebidoEm <= agoraMeteo &&
        agoraMeteo - leitura.recebidoEm <= 30 * 60 * 1000 &&
        horarioModeloHibrido <= agoraMeteo + 5 * 60 * 1000 &&
        Math.abs(
          agoraMeteo - horarioModeloHibrido
        ) <= 60 * 60 * 1000 &&
        Math.abs(
          leitura.recebidoEm - horarioModeloHibrido
        ) <= 30 * 60 * 1000
      );
    }
  );

  // COMPARAÇÃO ENTRE MODELO E ESTAÇÃO SELECIONADA
  const temperaturaModeloEstacao =
    estacaoSelecionadaMeteo &&
      pontosGradeTermica.length === TOTAL_PONTOS_GRADE_TERMICA
      ? estimarTemperaturaNaGrade(
        pontosGradeTermica,
        estacaoSelecionadaMeteo.latitude,
        estacaoSelecionadaMeteo.longitude
      )
      : null;

  const estacaoComparavelAgora =
    estacaoSelecionadaMeteo !== null &&
    estacoesAptasHibrido.some(
      estacao => estacao.id === estacaoSelecionadaMeteo.id
    ) &&
    temperaturaModeloEstacao !== null;

  const diferencaTemperaturaMeteo =
    estacaoComparavelAgora &&
      temperaturaModeloEstacao !== null &&
      leituraSelecionadaMeteo !== null
      ? leituraSelecionadaMeteo.temperatura -
      temperaturaModeloEstacao
      : null;

  const escalaTermicaAtual =
    obterEscalaTermica(pontosGradeTermica);

  // TEMPERATURA INTERPOLADA REPRESENTADA NO MAPA
  const temperaturaCorMapa =
    pontosGradeTermica.length === TOTAL_PONTOS_GRADE_TERMICA
      ? estimarTemperaturaNaGrade(
        pontosGradeTermica,
        pontoOpenMeteo.latitude,
        pontoOpenMeteo.longitude
      )
      : null;

  const cardStyle = {
    backgroundColor: 'white', borderRadius: '24px', padding: '24px', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.08)', display: 'flex', flexDirection: 'column' as const,
  };

  if (window.location.pathname === '/baixar') {
    return <PaginaBaixar />;
  }

  if (!minhaLocalizacao || carregamentoInicial) {
    return (
      <div
        style={{
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          height: '100vh',
          backgroundColor: '#F2F2F7'
        }}
      >
        <img
          src="/logonovopainel.png"
          alt="Cuidaí"
          style={{
            width: '130px',
            height: '130px',
            objectFit: 'contain',
            backgroundColor: 'transparent',
            animation: 'cuidaiLoading 1.6s ease-in-out infinite'
          }}
        />

        <style>{`
        @keyframes cuidaiLoading {
          0% {
            transform: scale(0.94);
            opacity: 0.65;
          }

          50% {
            transform: scale(1.06);
            opacity: 1;
          }

          100% {
            transform: scale(0.94);
            opacity: 0.65;
          }
        }
      `}</style>
      </div>
    );
  }

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        width: '100%',
        height: '100dvh',
        minHeight: 0,
        backgroundColor: '#F2F2F7',
        overflow: 'hidden'
      }}
    >



      {/* 👇 CABEÇALHO PARA MOBILE (Só aparece no telemóvel) 👇 */}
      {isMobile && (
        <div style={{ padding: '16px 20px', backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
          <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', color: '#1C1C1E' }}>
            <img
              src="/logonovopainel.png"
              alt="Cuidaí"
              style={{ width: '30px', height: '30px', objectFit: 'contain' }}
            /></h2>
          <button onClick={() => setMenuAberto(true)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <MdMenu size={28} color="#1C1C1E" />
          </button>
        </div>
      )}

      {/* MENU LATERAL */}
      <div
        style={{
          width: '260px',
          background: 'linear-gradient(180deg, #214563 0%, #152a3f 100%)',
          backdropFilter: 'blur(20px)',
          padding: '30px 20px',
          borderRight: '1px solid rgba(255,255,255,0.08)',
          display: 'flex',
          flexDirection: 'column',

          position: isMobile ? 'fixed' : 'relative',
          top: 0,
          bottom: 0,
          zIndex: 9999,

          left: isMobile
            ? (menuAberto ? '0' : '-100%')
            : '0',

          transition: 'left 0.3s ease',

          boxShadow:
            isMobile && menuAberto
              ? '10px 0 30px rgba(0,0,0,0.2)'
              : 'none'
        }}
      >

        {/* BOTÃO FECHAR - MOBILE */}
        {isMobile && (
          <button
            onClick={() => setMenuAberto(false)}
            style={{
              position: 'absolute',
              top: 20,
              right: 20,
              background: 'none',
              border: 'none',
              cursor: 'pointer',
              zIndex: 10000
            }}
          >
            <MdClose size={24} color="#FFFFFF" />
          </button>
        )}

        {/* LOGO + NOME */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            marginTop: isMobile ? '20px' : '0',
            marginBottom: '28px'
          }}
        >
          <img
            src="/logonovopainel.png"
            alt="Cuidaí"
            style={{
              width: '90px',
              height: '90px',
              objectFit: 'contain',
              marginBottom: '8px'
            }}
          />

          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'center',
              gap: '5px'
            }}
          >
            <span
              style={{
                color: '#FFFFFF',
                fontSize: '23px',
                fontWeight: '800',
                letterSpacing: '-0.5px'
              }}
            >
              Cuidaí
            </span>

            <span
              style={{
                fontSize: '11px',
                fontWeight: '700',
                color: 'rgba(255,255,255,0.60)',
                textTransform: 'uppercase'
              }}
            >
              Painel
            </span>
          </div>
        </div>

        {/* OPÇÕES DO MENU */}
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            marginTop: '10px',
            fontWeight: '500',
            flex: 1
          }}
        >
          {/* VISÃO GERAL */}
          <li
            onClick={() => {
              setAbaAtiva('visao_geral');
              setMenuAberto(false);
            }}
            style={{
              padding: '12px 16px',

              backgroundColor:
                abaAtiva === 'visao_geral'
                  ? '#007AFF'
                  : 'transparent',

              color:
                abaAtiva === 'visao_geral'
                  ? '#FFFFFF'
                  : 'rgba(255,255,255,0.78)',

              borderRadius: '12px',
              marginBottom: '8px',
              cursor: 'pointer',
              fontWeight: '600',

              boxShadow:
                abaAtiva === 'visao_geral'
                  ? '0 4px 12px rgba(0,122,255,0.30)'
                  : 'none',

              transition: '0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <MdSpaceDashboard size={20} />
            Visão Geral
          </li>

          {/* MAPA DE CALOR */}
          <li
            onClick={() => {
              setAbaAtiva('mapa_calor');
              setMenuAberto(false);
            }}
            style={{
              padding: '12px 16px',

              backgroundColor:
                abaAtiva === 'mapa_calor'
                  ? '#007AFF'
                  : 'transparent',

              color:
                abaAtiva === 'mapa_calor'
                  ? '#FFFFFF'
                  : 'rgba(255,255,255,0.78)',

              borderRadius: '12px',
              marginBottom: '8px',
              cursor: 'pointer',
              fontWeight: '600',

              boxShadow:
                abaAtiva === 'mapa_calor'
                  ? '0 4px 12px rgba(0,122,255,0.30)'
                  : 'none',

              transition: '0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <AiOutlineHeatMap size={20} />
            Mapa de Calor
          </li>

          {/* METEOROLOGIA */}
          <li
            onClick={() => {
              setAbaAtiva('meteorologia');
              setMenuAberto(false);
            }}
            style={{
              padding: '12px 16px',
              backgroundColor:
                abaAtiva === 'meteorologia' ? '#007AFF' : 'transparent',
              color:
                abaAtiva === 'meteorologia'
                  ? '#FFFFFF'
                  : 'rgba(255,255,255,0.78)',
              borderRadius: '12px',
              marginBottom: '8px',
              cursor: 'pointer',
              fontWeight: '600',
              display: 'flex',
              alignItems: 'center',
              gap: '10px',
              transition: '0.2s',
              boxShadow:
                abaAtiva === 'meteorologia'
                  ? '0 4px 12px rgba(0,122,255,0.30)'
                  : 'none'
            }}
          >
            <MdCloud size={20} />
            Meteorologia
          </li>

          {/* SOBRE O PROJETO */}
          <li
            onClick={() => {
              setAbaAtiva('sobre');
              setMenuAberto(false);
            }}
            style={{
              padding: '12px 16px',

              backgroundColor:
                abaAtiva === 'sobre'
                  ? '#007AFF'
                  : 'transparent',

              color:
                abaAtiva === 'sobre'
                  ? '#FFFFFF'
                  : 'rgba(255,255,255,0.78)',

              borderRadius: '12px',
              marginBottom: '8px',
              cursor: 'pointer',
              fontWeight: '600',

              boxShadow:
                abaAtiva === 'sobre'
                  ? '0 4px 12px rgba(0,122,255,0.30)'
                  : 'none',

              transition: '0.2s',
              display: 'flex',
              alignItems: 'center',
              gap: '10px'
            }}
          >
            <FaInfoCircle size={18} />
            Sobre o Projeto
          </li>
        </ul>

        {/* EXPORTAR CSV */}
        <div
          onClick={exportarDados}
          style={{
            padding: '12px 16px',
            cursor: 'pointer',
            transition: '0.2s',
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: '#FFFFFF',
            fontWeight: '600',
            backgroundColor: 'rgba(255,255,255,0.12)',
            border: '1px solid rgba(255,255,255,0.12)',
            borderRadius: '12px',
            justifyContent: 'center'
          }}
        >
          <FaDownload size={16} />
          Exportar CSV
        </div>
      </div>

      {/* ÁREA PRINCIPAL DINÂMICA */}
      <div
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          padding: isMobile
            ? '20px 20px calc(36px + env(safe-area-inset-bottom))'
            : '30px 40px',
          display: 'flex',
          flexDirection: 'column',
          gap: '24px',
          overflowY: 'auto',
          overflowX: 'hidden',
          boxSizing: 'border-box'
        }}
      >

        {abaAtiva === 'visao_geral' && (
          /* =================== VISÃO GERAL =================== */
          <>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', flexDirection: isMobile ? 'column' : 'row', gap: '10px' }}>
              <div>
                <h1 style={{ margin: 0, color: '#1C1C1E', fontSize: isMobile ? '26px' : '30px', fontWeight: '800', letterSpacing: '-0.8px' }}>Visão Geral</h1>
                <p style={{ margin: '5px 0 0', color: '#8E8E93', fontSize: '14px' }}>Acompanhe os registros enviados pela comunidade.</p>
              </div>

              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                flexWrap: 'wrap'
              }}>
                {['Todas', 'Chuvas', 'Passagem', 'Energia', 'Estrada', 'Quentura'].map(categoria => (
                  <button
                    key={categoria}
                    onClick={() => setFiltroCategoria(categoria)}
                    style={{
                      border: 'none',
                      padding: '8px 14px',
                      borderRadius: '20px',
                      cursor: 'pointer',
                      fontSize: '12px',
                      fontWeight: '700',
                      backgroundColor: filtroCategoria === categoria ? '#007AFF' : '#FFFFFF',
                      color: filtroCategoria === categoria ? '#FFFFFF' : '#636366',
                      boxShadow: filtroCategoria === categoria
                        ? '0 4px 12px rgba(0,122,255,0.25)'
                        : '0 2px 8px rgba(0,0,0,0.06)'
                    }}
                  >
                    {categoria}
                  </button>
                ))}
              </div>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '7px',
                fontSize: '12px',
                fontWeight: '700',
                color: online ? '#34C759' : '#FF3B30'
              }}>
                <span style={{
                  width: '8px',
                  height: '8px',
                  borderRadius: '50%',
                  backgroundColor: online ? '#34C759' : '#FF3B30',
                  boxShadow: online ? '0 0 8px rgba(52,199,89,0.45)' : 'none'
                }} />

                {online ? 'Atualização em tempo real' : 'Sem conexão'}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3,1fr)', gap: '24px' }}>
              <div style={cardStyle}>
                <span style={{ color: '#8E8E93', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Total de registros</span>
                <span style={{ color: '#1C1C1E', fontSize: '40px', fontWeight: '800', marginTop: '8px' }}>
                  {alertasVisaoGeral.length}
                </span>

                <span style={{ color: '#8E8E93', fontSize: '12px', marginTop: '3px' }}>
                  {alertasAtivosVisao.length} ativos • {alertasResolvidosVisao.length} resolvidos
                </span>
              </div>

              <div style={cardStyle}>
                <span style={{ color: '#8E8E93', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Mais frequente</span>
                <span style={{ color: '#1C1C1E', fontSize: '24px', fontWeight: '800', marginTop: '15px' }}>
                  {dadosGrafico.length > 0 ? [...dadosGrafico].sort((a, b) => b.quantidade - a.quantidade)[0].nome : '---'}
                </span>
                <span style={{ color: '#8E8E93', fontSize: '12px', marginTop: '5px' }}>Categoria com mais registros</span>
              </div>

              <div style={cardStyle}>
                <span style={{ color: '#8E8E93', fontSize: '12px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Último registro</span>
                <span style={{ color: '#007AFF', fontSize: '30px', fontWeight: '800', marginTop: '10px' }}>
                  {alertasRecentes[0]?.hora || '--:--'}
                </span>
                <span style={{ color: '#8E8E93', fontSize: '12px', marginTop: '3px' }}>
                  {alertasRecentes[0]?.categoria || 'Nenhuma ocorrência'}
                </span>
              </div>        </div>

            <div style={{
              ...cardStyle,
              padding: '18px 22px',
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr 1fr' : '1.4fr repeat(3,1fr)',
              gap: '18px',
              alignItems: 'center'
            }}>
              <div>
                <div style={{ fontSize: '12px', fontWeight: '800', color: '#007AFF', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
                  Pluviometria comunitária
                </div>

                <div style={{ fontSize: '12px', color: '#8E8E93', marginTop: '4px' }}>
                  Medições informadas pelos usuários
                </div>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#8E8E93' }}>
                  Medições
                </div>

                <strong style={{ fontSize: '22px', color: '#1C1C1E' }}>
                  {alertasComPluviometro.length}
                </strong>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#8E8E93' }}>
                  Média
                </div>

                <strong style={{ fontSize: '22px', color: '#007AFF' }}>
                  {mediaPluviometria.toFixed(1)} mm
                </strong>
              </div>

              <div>
                <div style={{ fontSize: '11px', color: '#8E8E93' }}>
                  Maior medição
                </div>

                <strong style={{ fontSize: '22px', color: '#1C1C1E' }}>
                  {maiorPluviometria.toFixed(1)} mm
                </strong>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '2fr 1fr', gap: '24px' }}>

              {/* EVOLUÇÃO DIÁRIA */}
              <div style={{ ...cardStyle, minHeight: isMobile ? '330px' : '440px' }}>
                <div style={{ marginBottom: '20px' }}>
                  <h3 style={{ color: '#1C1C1E', fontSize: '18px', fontWeight: '700', margin: '0 0 5px' }}>Evolução dos registros</h3>
                  <span style={{ color: '#8E8E93', fontSize: '12px' }}>Quantidade de ocorrências registradas ao longo do tempo</span>
                </div>

                <div style={{ flex: 1, minHeight: '250px' }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={dadosLinhaTempo} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <defs>
                        <linearGradient id="corOnda" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%" stopColor="#007AFF" stopOpacity={0.22} />
                          <stop offset="95%" stopColor="#007AFF" stopOpacity={0} />
                        </linearGradient>
                      </defs>

                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5EA" />
                      <XAxis dataKey="data" stroke="#8E8E93" fontSize={11} axisLine={false} tickLine={false} />
                      <YAxis stroke="#8E8E93" fontSize={11} width={30} axisLine={false} tickLine={false} allowDecimals={false} />

                      <Tooltip
                        contentStyle={{
                          borderRadius: '14px',
                          border: 'none',
                          boxShadow: '0 8px 24px rgba(0,0,0,0.12)'
                        }}
                      />

                      <Area type="monotone" dataKey="ocorrencias" name="Registros" stroke="#007AFF" strokeWidth={3} fill="url(#corOnda)" />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* COLUNA DA DIREITA */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>

                {/* OCORRÊNCIAS POR TIPO */}
                <div style={{ ...cardStyle, minHeight: '205px' }}>
                  <h3 style={{ color: '#1C1C1E', fontSize: '16px', fontWeight: '700', margin: '0 0 15px' }}>Ocorrências por tipo</h3>

                  <div style={{ height: '155px' }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={dadosGrafico} layout="vertical" margin={{ top: 0, right: 10, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#E5E5EA" />

                        <XAxis type="number" fontSize={10} axisLine={false} tickLine={false} allowDecimals={false} />
                        <YAxis type="category" dataKey="nome" width={85} fontSize={10} axisLine={false} tickLine={false} />

                        <Tooltip
                          cursor={{ fill: '#F2F2F7' }}
                          contentStyle={{ borderRadius: '12px', border: 'none' }}
                        />

                        <Bar dataKey="quantidade" name="Registros" radius={[0, 6, 6, 0]} maxBarSize={20}>
                          {dadosGrafico.map((_, index) =>
                            <Cell key={`cell-bar-${index}`} fill={CORES[index % CORES.length]} />
                          )}
                        </Bar>
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* PLUVIOMETRIA RECENTE */}
                <div style={{ ...cardStyle, minHeight: '205px' }}>
                  <div style={{ marginBottom: '10px' }}>
                    <h3
                      style={{
                        color: '#1C1C1E',
                        fontSize: '16px',
                        fontWeight: '700',
                        margin: 0
                      }}
                    >
                      Pluviometria recente
                    </h3>

                    <span
                      style={{
                        color: '#8E8E93',
                        fontSize: '11px'
                      }}
                    >
                      Últimas medições registradas pela comunidade
                    </span>
                  </div>

                  <div style={{ height: '145px' }}>
                    {dadosPluviometriaRecente.length > 0 ? (
                      <ResponsiveContainer width="100%" height="100%">
                        <AreaChart
                          data={dadosPluviometriaRecente}
                          margin={{ top: 10, right: 5, left: -22, bottom: 0 }}
                        >
                          <defs>
                            <linearGradient
                              id="corPluviometria"
                              x1="0"
                              y1="0"
                              x2="0"
                              y2="1"
                            >
                              <stop
                                offset="5%"
                                stopColor="#007AFF"
                                stopOpacity={0.25}
                              />
                              <stop
                                offset="95%"
                                stopColor="#007AFF"
                                stopOpacity={0}
                              />
                            </linearGradient>
                          </defs>

                          <CartesianGrid
                            strokeDasharray="3 3"
                            vertical={false}
                            stroke="#E5E5EA"
                          />

                          <XAxis
                            dataKey="momento"
                            fontSize={9}
                            axisLine={false}
                            tickLine={false}
                            stroke="#8E8E93"
                          />

                          <YAxis
                            fontSize={9}
                            axisLine={false}
                            tickLine={false}
                            stroke="#8E8E93"
                            unit=" mm"
                          />

                          <Tooltip
                            formatter={(valor: any) => [`${valor} mm`, 'Chuva']}
                            contentStyle={{
                              borderRadius: '12px',
                              border: 'none'
                            }}
                          />

                          <Area
                            type="monotone"
                            dataKey="valor"
                            stroke="#007AFF"
                            strokeWidth={3}
                            fill="url(#corPluviometria)"
                            dot={{
                              r: 3,
                              fill: '#007AFF',
                              strokeWidth: 0
                            }}
                            activeDot={{
                              r: 5
                            }}
                          />
                        </AreaChart>
                      </ResponsiveContainer>
                    ) : (
                      <div
                        style={{
                          height: '100%',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#8E8E93',
                          fontSize: '12px',
                          textAlign: 'center'
                        }}
                      >
                        Nenhuma medição de chuva registrada.
                      </div>
                    )}
                  </div>
                </div>

              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '7fr 3fr', gap: '24px', flex: 1, minHeight: isMobile ? 'auto' : '380px' }}>
              <div style={{ ...cardStyle, padding: 0, overflow: 'hidden', minHeight: isMobile ? '400px' : 'auto' }}>
                <MapContainer
                  center={minhaLocalizacao}
                  zoom={14}
                  style={{
                    height: '100%',
                    width: '100%',
                    zIndex: 1,
                    backgroundColor: '#FFFFFF'
                  }}
                >
                  <TileLayer
                    className="mapa-cuidai"
                    url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                  />

                  {alertasAtivos.map((alerta) => {
                    const cor = getCorCategoria(alerta.categoria);

                    return <Marker key={alerta.id} position={[alerta.latitude, alerta.longitude]} icon={criarIconeVazado(cor)}>
                      <Popup>
                        <div style={{ minWidth: '180px' }}>
                          <strong style={{ color: cor, fontSize: '14px' }}>{alerta.categoria}</strong>

                          <div style={{ marginTop: '6px', fontSize: '13px', color: '#333' }}>
                            {alerta.detalhe || alerta.titulo}
                          </div>

                          {typeof alerta.milimetrosChuva === 'number' && (
                            <div style={{ marginTop: '8px', padding: '7px 9px', backgroundColor: '#EAF5FF', borderRadius: '10px' }}>
                              <span style={{ fontSize: '11px', color: '#6E6E73' }}>Pluviometria</span>
                              <div style={{ fontSize: '18px', fontWeight: '800', color: '#007AFF' }}>
                                {alerta.milimetrosChuva.toFixed(1)} mm
                              </div>
                            </div>
                          )}

                          <div style={{ marginTop: '8px', fontSize: '11px', color: '#8E8E93' }}>{alerta.hora}</div>

                          {(alerta.votosConfirma || 0) > 0 && (
                            <div style={{ marginTop: '5px', fontSize: '11px', color: '#34C759', fontWeight: '700' }}>
                              ✓ {alerta.votosConfirma} {alerta.votosConfirma === 1 ? 'confirmação' : 'confirmações'}
                            </div>
                          )}
                          {alerta.fotoUrl && (
                            <div style={{
                              marginTop: '10px',
                              paddingTop: '10px',
                              borderTop: '1px solid #E5E5EA'
                            }}>
                              <div style={{
                                fontSize: '11px',
                                color: '#8E8E93',
                                fontWeight: '700',
                                marginBottom: '6px'
                              }}>
                                FOTO DA OCORRÊNCIA
                              </div>

                              <a
                                href={alerta.fotoUrl}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{
                                  display: 'block',
                                  textDecoration: 'none'
                                }}
                              >
                                <img
                                  src={alerta.fotoUrl}
                                  alt="Foto da ocorrência"
                                  style={{
                                    width: '100%',
                                    height: '110px',
                                    objectFit: 'cover',
                                    borderRadius: '10px',
                                    display: 'block'
                                  }}
                                />

                                <div style={{
                                  marginTop: '6px',
                                  padding: '7px',
                                  textAlign: 'center',
                                  backgroundColor: '#EAF5FF',
                                  color: '#007AFF',
                                  borderRadius: '8px',
                                  fontSize: '11px',
                                  fontWeight: '800'
                                }}>
                                  Ver foto em tamanho maior
                                </div>
                              </a>
                            </div>
                          )}
                        </div>
                      </Popup>
                    </Marker>;
                  })}
                </MapContainer>
              </div>

              <div style={{ ...cardStyle, overflowY: 'auto', maxHeight: isMobile ? '400px' : 'none' }}>
                <h3 style={{ color: '#1C1C1E', fontSize: '18px', fontWeight: '700', display: 'flex', justifyContent: 'space-between' }}><span>Feed ao Vivo</span><span style={{ fontSize: '11px', backgroundColor: '#F2F2F7', padding: '4px 10px', borderRadius: '20px', color: '#8E8E93' }}>AGORA</span></h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                  {alertasRecentes.slice(0, 15).map((alerta) => {
                    const cor = getCorCategoria(alerta.categoria);

                    return (
                      <div key={alerta.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}>
                        <div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: cor, marginTop: '6px', boxShadow: `0 0 8px ${cor}66` }} />

                        <div style={{ flex: 1 }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                            <strong style={{ color: '#1C1C1E', fontSize: '14px' }}>
                              {alerta.categoria}
                            </strong>

                            <span style={{ color: '#8E8E93', fontSize: '12px' }}>
                              {alerta.hora}
                            </span>
                          </div>

                          <div style={{ color: '#8E8E93', fontSize: '13px', marginTop: '3px' }}>
                            {alerta.detalhe || alerta.titulo}
                          </div>

                          {typeof alerta.milimetrosChuva === 'number' && (
                            <div style={{ display: 'inline-block', marginTop: '6px', padding: '3px 8px', borderRadius: '10px', backgroundColor: '#EAF5FF', color: '#007AFF', fontSize: '11px', fontWeight: '800' }}>
                              {alerta.milimetrosChuva.toFixed(1)} mm
                            </div>
                          )}

                          {alerta.fotoUrl && (
                            <div style={{
                              display: 'inline-block',
                              marginTop: '5px',
                              marginRight: '6px',
                              padding: '3px 7px',
                              borderRadius: '8px',
                              backgroundColor: '#F2F2F7',
                              color: '#636366',
                              fontSize: '10px',
                              fontWeight: '700'
                            }}>
                              Foto disponível
                            </div>
                          )}

                          {(alerta.votosConfirma || 0) > 0 && (
                            <div style={{ marginTop: '5px', fontSize: '10px', color: '#34C759', fontWeight: '700' }}>
                              ✓ {alerta.votosConfirma} {alerta.votosConfirma === 1 ? 'confirmação' : 'confirmações'}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {/* =================== METEOROLOGIA =================== */}
        {abaAtiva === 'meteorologia' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '24px'
            }}
          >
            {/* CABEÇALHO */}
            <div>
              <span
                style={{
                  fontSize: '11px',
                  fontWeight: '800',
                  color: '#168FC4',
                  letterSpacing: '1px'
                }}
              >
                CUIDAÍ | OBSERVATÓRIO METEOROLÓGICO
              </span>

              <h1
                style={{
                  margin: '8px 0 5px',
                  color: '#1C1C1E',
                  fontSize: isMobile ? '26px' : '30px',
                  fontWeight: '800'
                }}
              >
                Meteorologia
              </h1>

              <p
                style={{
                  color: '#8E8E93',
                  fontSize: '14px',
                  margin: 0
                }}
              >
                Monitoramento ambiental, estações meteorológicas
                e análise climática do território.
              </p>
            </div>

            {erroMeteo && (
              <p style={{ color: '#B42318', fontSize: '13px' }}>
                {erroMeteo}
              </p>
            )}

            {!carregandoMeteo && !erroMeteo && estacoesMeteo.length === 0 && (
              <p style={{ color: '#8E8E93', fontSize: '13px' }}>
                Nenhuma estação meteorológica publicada foi encontrada.
              </p>
            )}

            {estacaoSelecionadaMeteo && (
              <div style={{
                padding: '12px 16px',
                backgroundColor: '#EAF5FF',
                borderRadius: '12px',
                color: '#214563',
                fontSize: '13px'
              }}>
                <strong>Estação selecionada:</strong>{' '}
                {estacaoSelecionadaMeteo.nome}
                {' • '}
                {estacaoSelecionadaMeteo.municipio}
                {' • '}
                {leituraRecenteMeteo
                  ? 'Leitura recente'
                  : 'Sem leitura recente'}
              </div>
            )}


            {/* ANÁLISE COMPARATIVA DAS FONTES */}
            {estacaoSelecionadaMeteo && (
              <div
                style={{
                  backgroundColor: '#FFFFFF',
                  borderRadius: '22px',
                  padding: isMobile ? '18px' : '24px',
                  boxShadow: '0 8px 28px rgba(33, 69, 99, 0.06)',
                  border: '1px solid #E5ECF4'
                }}
              >
                <div style={{ marginBottom: '18px' }}>
                  <h2
                    style={{
                      color: '#214563',
                      fontSize: '18px',
                      fontWeight: '800',
                      margin: '0 0 6px'
                    }}
                  >
                    Análise das fontes meteorológicas
                  </h2>

                  <p
                    style={{
                      color: '#8E8E93',
                      fontSize: '12px',
                      margin: 0
                    }}
                  >
                    {estacaoSelecionadaMeteo.nome}
                    {' • '}
                    {estacaoSelecionadaMeteo.municipio}
                  </p>
                </div>

                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: isMobile
                      ? '1fr'
                      : 'repeat(3, minmax(0, 1fr))',
                    gap: '14px'
                  }}
                >
                  {[
                    {
                      titulo: 'Open-Meteo',
                      valor: temperaturaModeloEstacao !== null
                        ? `${temperaturaModeloEstacao.toFixed(1)} °C`
                        : '—',
                      subtitulo: horarioModeloHibrido
                        ? `Estimativa da grade • ${new Date(
                          horarioModeloHibrido
                        ).toLocaleString('pt-BR')}`
                        : 'Estimativa não disponível',
                      cor: '#E58047'
                    },
                    {
                      titulo: 'Estação CUIDAÍ',
                      valor: leituraSelecionadaMeteo
                        ? `${leituraSelecionadaMeteo.temperatura.toFixed(1)} °C`
                        : '—',
                      subtitulo: leituraSelecionadaMeteo
                        ? `Leitura de ${new Date(
                          leituraSelecionadaMeteo.recebidoEm
                        ).toLocaleString('pt-BR')}`
                        : 'Sem leitura registrada',
                      cor: '#168FC4'
                    },
                    {
                      titulo: 'Diferença entre fontes',
                      valor: diferencaTemperaturaMeteo !== null
                        ? `${diferencaTemperaturaMeteo > 0 ? '+' : ''}${diferencaTemperaturaMeteo.toFixed(1)} °C`
                        : '—',
                      subtitulo: diferencaTemperaturaMeteo !== null
                        ? 'Medições temporalmente compatíveis'
                        : 'Comparação atual indisponível',
                      cor: '#214563'
                    }
                  ].map(item => (
                    <div
                      key={item.titulo}
                      style={{
                        minWidth: 0,
                        backgroundColor: '#F8FAFD',
                        border: '1px solid #E8EDF4',
                        borderRadius: '16px',
                        padding: '18px'
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          color: '#64748B',
                          fontSize: '12px',
                          fontWeight: '700',
                          marginBottom: '10px'
                        }}
                      >
                        {item.titulo}
                      </span>

                      <strong
                        style={{
                          color: item.cor,
                          fontSize: '24px',
                          fontWeight: '800',
                          display: 'block',
                          marginBottom: '10px'
                        }}
                      >
                        {item.valor}
                      </strong>

                      <span
                        style={{
                          display: 'block',
                          color: '#8E8E93',
                          fontSize: '11px',
                          lineHeight: '1.5'
                        }}
                      >
                        {item.subtitulo}
                      </span>
                    </div>
                  ))}
                </div>

                <div
                  style={{
                    marginTop: '16px',
                    padding: '12px 14px',
                    borderRadius: '12px',
                    backgroundColor: '#EAF5FF',
                    fontSize: '12px',
                    color: '#45627A',
                    lineHeight: '1.6'
                  }}
                >
                  {estacaoComparavelAgora
                    ? 'A estação possui uma leitura recente, temporalmente compatível com a grade meteorológica. O ajuste local experimental está habilitado para esta estação.'
                    : 'Esta estação não possui uma leitura recente compatível com o modelo. Sua última medição permanece disponível para análise histórica, mas não modifica o mapa climático atual.'}
                </div>

                <p
                  style={{
                    color: '#8E8E93',
                    fontSize: '11px',
                    lineHeight: '1.6',
                    margin: '12px 0 0'
                  }}
                >
                  A temperatura Open-Meteo apresentada é interpolada
                  a partir da grade regional de {pontosGradeTermica.length} pontos. A diferença
                  entre fontes é uma comparação experimental e deve
                  considerar a incerteza do sensor e do modelo.
                </p>
              </div>
            )}


            {/* INDICADORES */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile
                  ? 'repeat(2, 1fr)'
                  : 'repeat(4, 1fr)',
                gap: '16px'
              }}
            >
              {indicadoresMeteo.map((indicador) => (
                <div key={indicador.titulo} style={cardStyle}>
                  <span
                    style={{
                      fontSize: '12px',
                      fontWeight: '700',
                      color: '#8E8E93'
                    }}
                  >
                    {indicador.titulo}
                  </span>

                  <strong
                    style={{
                      fontSize: '25px',
                      color: '#1C1C1E',
                      marginTop: '12px'
                    }}
                  >
                    {indicador.valor}
                  </strong>

                  <span
                    style={{
                      fontSize: '11px',
                      color: '#8E8E93',
                      marginTop: '6px'
                    }}
                  >
                    {indicador.legenda}
                  </span>
                </div>
              ))}
            </div>

            {/* NOVO ATLAS TERRITORIAL — TESTE */}
            <div style={{ marginBottom: '24px' }}>
              <AtlasBrasil />
            </div>

            {/* MAPA METEOROLÓGICO */}
            <div style={{ ...cardStyle, gap: '16px' }}>
              <div>
                <h2
                  style={{
                    fontSize: '19px',
                    color: '#1C1C1E',
                    margin: '0 0 6px',
                    fontWeight: '800'
                  }}
                >
                  Mapa meteorológico
                </h2>

                <p
                  style={{
                    fontSize: '12px',
                    color: '#8E8E93',
                    margin: 0
                  }}
                >
                  Visualização territorial das condições meteorológicas.
                </p>
              </div>

              {/* CONSULTA REGIONAL OPEN-METEO */}
              <div
                style={{
                  backgroundColor: '#F5F9FD',
                  border: '1px solid #E2EBF4',
                  borderRadius: '18px',
                  padding: isMobile ? '16px' : '20px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    flexWrap: 'wrap',
                    gap: '12px',
                    marginBottom: '16px'
                  }}
                >
                  <div>
                    <strong
                      style={{
                        fontSize: '15px',
                        color: '#214563'
                      }}
                    >
                      Condições meteorológicas regionais
                    </strong>

                    <p
                      style={{
                        fontSize: '12px',
                        color: '#64748B',
                        margin: '5px 0 0'
                      }}
                    >
                      Clique em qualquer ponto do mapa para consultar.
                    </p>
                  </div>

                  <span
                    style={{
                      backgroundColor: '#E7F2FC',
                      color: '#168FC4',
                      borderRadius: '10px',
                      padding: '8px 11px',
                      fontSize: '11px',
                      fontWeight: '700'
                    }}
                  >
                    Open-Meteo · Modelo meteorológico
                  </span>
                </div>

                {carregandoOpenMeteo ? (
                  <p style={{ color: '#64748B', fontSize: '13px' }}>
                    Consultando condições meteorológicas...
                  </p>
                ) : erroOpenMeteo ? (
                  <p style={{ color: '#B42318', fontSize: '13px' }}>
                    {erroOpenMeteo}
                  </p>
                ) : dadosOpenMeteo ? (
                  <>
                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns: isMobile
                          ? 'repeat(2, minmax(0, 1fr))'
                          : 'repeat(4, minmax(0, 1fr))',
                        gap: '12px'
                      }}
                    >
                      {[
                        {
                          titulo: 'Temperatura',
                          valor: `${dadosOpenMeteo.temperatura.toFixed(1)} °C`,
                          cor: '#E58047'
                        },
                        {
                          titulo: 'Sensação térmica',
                          valor: `${dadosOpenMeteo.sensacao.toFixed(1)} °C`,
                          cor: '#D15B4B'
                        },
                        {
                          titulo: 'Umidade',
                          valor: `${dadosOpenMeteo.umidade.toFixed(0)}%`,
                          cor: '#168FC4'
                        },
                        {
                          titulo: 'Vento',
                          valor: `${dadosOpenMeteo.vento.toFixed(1)} km/h`,
                          cor: '#214563'
                        }
                      ].map((item) => (
                        <div
                          key={item.titulo}
                          style={{
                            backgroundColor: '#FFFFFF',
                            padding: '15px',
                            borderRadius: '14px',
                            minWidth: 0
                          }}
                        >
                          <span
                            style={{
                              display: 'block',
                              color: '#8E8E93',
                              fontSize: '11px',
                              marginBottom: '8px'
                            }}
                          >
                            {item.titulo}
                          </span>

                          <strong
                            style={{
                              display: 'block',
                              color: item.cor,
                              fontSize: isMobile ? '19px' : '23px'
                            }}
                          >
                            {item.valor}
                          </strong>
                        </div>
                      ))}
                    </div>

                    <p
                      style={{
                        margin: '14px 0 0',
                        color: '#64748B',
                        fontSize: '11px'
                      }}
                    >
                      Ponto consultado: {pontoOpenMeteo.latitude.toFixed(4)},
                      {' '}{pontoOpenMeteo.longitude.toFixed(4)}
                      {' • '}
                      Referência: {dadosOpenMeteo.horario.replace('T', ' às ')}
                      {' (horário de Fortaleza)'}
                    </p>

                    {/* COMPARAÇÃO ENTRE COR DO MAPA E CONSULTA PONTUAL */}
                    {temperaturaCorMapa !== null && (
                      <div
                        style={{
                          marginTop: '14px',
                          padding: '14px 16px',
                          backgroundColor: '#FFFFFF',
                          border: '1px solid #DCE8F3',
                          borderRadius: '12px',
                          display: 'flex',
                          flexWrap: 'wrap',
                          gap: '24px',
                          alignItems: 'center'
                        }}
                      >
                        <div>
                          <span
                            style={{
                              fontSize: '11px',
                              color: '#64748B',
                              display: 'block',
                              marginBottom: '5px'
                            }}
                          >
                            Temperatura usada na cor do mapa
                          </span>

                          <strong
                            style={{
                              color: '#214563',
                              fontSize: '19px'
                            }}
                          >
                            {temperaturaCorMapa.toFixed(1)} °C
                          </strong>
                        </div>

                        <div>
                          <span
                            style={{
                              fontSize: '11px',
                              color: '#64748B',
                              display: 'block',
                              marginBottom: '5px'
                            }}
                          >
                            Consulta direta Open-Meteo
                          </span>

                          <strong
                            style={{
                              color: '#168FC4',
                              fontSize: '19px'
                            }}
                          >
                            {dadosOpenMeteo.temperatura.toFixed(1)} °C
                          </strong>
                        </div>

                        <div>
                          <span
                            style={{
                              fontSize: '11px',
                              color: '#64748B',
                              display: 'block',
                              marginBottom: '5px'
                            }}
                          >
                            Diferença absoluta
                          </span>

                          <strong
                            style={{
                              color: '#214563',
                              fontSize: '19px'
                            }}
                          >
                            {Math.abs(
                              temperaturaCorMapa - dadosOpenMeteo.temperatura
                            ).toFixed(1)} °C
                          </strong>
                        </div>
                      </div>
                    )}
                  </>
                ) : null}

                <p
                  style={{
                    margin: '12px 0 0',
                    color: '#8E8E93',
                    fontSize: '11px'
                  }}
                >
                  Valores estimados por modelos meteorológicos.
                  Não são medições da Estação CUIDAÍ.
                </p>
              </div>


              {/* INTEGRAÇÃO AUTOMÁTICA DAS FONTES METEOROLÓGICAS */}
              <div
                style={{
                  backgroundColor: '#F5F9FD',
                  border: '1px solid #DCE8F3',
                  borderRadius: '16px',
                  padding: '16px 18px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    flexWrap: 'wrap',
                    gap: '10px'
                  }}
                >
                  <strong
                    style={{
                      fontSize: '14px',
                      color: '#214563'
                    }}
                  >
                    Mapa climático integrado CUIDAÍ
                  </strong>

                  <span
                    style={{
                      backgroundColor: '#E5F2FA',
                      color: '#168FC4',
                      padding: '7px 11px',
                      borderRadius: '10px',
                      fontSize: '11px',
                      fontWeight: '700'
                    }}
                  >
                    Integração automática
                  </span>
                </div>

                <p
                  style={{
                    color: '#64748B',
                    fontSize: '12px',
                    lineHeight: '1.6',
                    margin: '12px 0'
                  }}
                >
                  A Open-Meteo fornece as estimativas regionais de temperatura.
                  As estações CUIDAÍ acrescentam observações locais que podem
                  ajustar o mapa em suas proximidades, quando houver medições
                  recentes compatíveis.
                </p>

                <div
                  style={{
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '8px'
                  }}
                >
                  <span
                    style={{
                      backgroundColor: '#FFFFFF',
                      color: '#214563',
                      padding: '9px 12px',
                      borderRadius: '10px',
                      border: '1px solid #E2EBF4',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    Open-Meteo · Referência regional
                  </span>

                  <span
                    style={{
                      backgroundColor: '#FFFFFF',
                      color: '#214563',
                      padding: '9px 12px',
                      borderRadius: '10px',
                      border: '1px solid #E2EBF4',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    {estacoesMeteo.length} estações publicadas
                  </span>

                  <span
                    style={{
                      backgroundColor: estacoesAptasHibrido.length > 0
                        ? '#E7F5EF'
                        : '#F2F4F7',
                      color: estacoesAptasHibrido.length > 0
                        ? '#287856'
                        : '#64748B',
                      padding: '9px 12px',
                      borderRadius: '10px',
                      fontSize: '12px',
                      fontWeight: '700'
                    }}
                  >
                    {estacoesAptasHibrido.length} contribuindo agora
                  </span>
                </div>

                <div
                  style={{
                    marginTop: '12px',
                    color: '#64748B',
                    fontSize: '11px',
                    lineHeight: '1.6'
                  }}
                >
                  {estacoesAptasHibrido.length > 0
                    ? `As medições de ${estacoesAptasHibrido.length} estação(ões)
         estão sendo consideradas no ajuste local experimental
         de até 500 metros.`
                    : 'Nenhuma estação possui leitura recente compatível neste momento. O mapa utiliza somente as estimativas regionais da Open-Meteo.'}
                </div>
              </div>


              {/* DIAGNÓSTICO DA VARIAÇÃO LOCAL */}
              <div
                style={{
                  padding: '16px 18px',
                  backgroundColor: '#F5F9FD',
                  border: '1px solid #DCE8F3',
                  borderRadius: '16px'
                }}
              >
                <strong
                  style={{
                    fontSize: '14px',
                    color: '#214563'
                  }}
                >
                  Variação térmica próxima ao ponto selecionado
                </strong>

                {carregandoAmplitudeLocal ? (
                  <p style={{ color: '#64748B', fontSize: '12px' }}>
                    Consultando temperaturas da região...
                  </p>
                ) : erroAmplitudeLocal ? (
                  <p style={{ color: '#B42318', fontSize: '12px' }}>
                    {erroAmplitudeLocal}
                  </p>
                ) : amplitudeLocalMeteo ? (
                  <div style={{ marginTop: '12px' }}>
                    <div
                      style={{
                        fontSize: '23px',
                        fontWeight: '800',
                        color: '#214563'
                      }}
                    >
                      {amplitudeLocalMeteo.minimo.toFixed(1)} °C
                      {' — '}
                      {amplitudeLocalMeteo.maximo.toFixed(1)} °C
                    </div>

                    <p
                      style={{
                        fontSize: '12px',
                        color: '#64748B',
                        margin: '8px 0 0'
                      }}
                    >
                      {amplitudeLocalMeteo.quantidade} pontos consultados
                      em uma região de aproximadamente 45 km de largura.
                      {' '}
                      Amplitude térmica:
                      {' '}
                      {(
                        amplitudeLocalMeteo.maximo -
                        amplitudeLocalMeteo.minimo
                      ).toFixed(1)} °C.
                    </p>
                  </div>
                ) : null}
              </div>


              {/* CONTROLES DA CAMADA TÉRMICA */}
              <div
                style={{
                  backgroundColor: '#F8FAFD',
                  border: '1px solid #E5ECF4',
                  borderRadius: '16px',
                  padding: '16px'
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    flexWrap: 'wrap',
                    gap: '12px'
                  }}
                >
                  <div>
                    <strong
                      style={{
                        display: 'block',
                        fontSize: '14px',
                        color: '#214563'
                      }}
                    >
                      Temperatura no território
                    </strong>

                    <span
                      style={{
                        color: '#8E8E93',
                        fontSize: '11px'
                      }}
                    >
                      Estimativas regionais da Open-Meteo com integração automática das estações CUIDAÍ
                    </span>
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      setMostrarGradeTermica(atual => !atual)
                    }
                    style={{
                      border: '1px solid #DCE6F0',
                      borderRadius: '12px',
                      padding: '9px 14px',
                      backgroundColor: mostrarGradeTermica
                        ? '#168FC4'
                        : '#FFFFFF',
                      color: mostrarGradeTermica
                        ? '#FFFFFF'
                        : '#214563',
                      fontWeight: '700',
                      fontSize: '12px',
                      cursor: 'pointer'
                    }}
                  >
                    {mostrarGradeTermica
                      ? 'Ocultar camada'
                      : 'Mostrar camada'}
                  </button>
                </div>

                {carregandoGradeTermica && (
                  <p style={{ color: '#64748B', fontSize: '12px' }}>
                    Carregando mapa de temperaturas...
                  </p>
                )}

                {erroGradeTermica && (
                  <p style={{ color: '#B42318', fontSize: '12px' }}>
                    {erroGradeTermica}
                  </p>
                )}

                {erroContornoCeara && (
                  <p style={{ color: '#B42318', fontSize: '12px' }}>
                    {erroContornoCeara}
                  </p>
                )}



                {/* LEGENDA AUTOMÁTICA COM CORES HEX */}
                <div style={{ marginTop: '16px' }}>
                  {pontosGradeTermica.length > 0 ? (
                    <div
                      style={{
                        display: 'flex',
                        flexWrap: 'nowrap',
                        gap: '6px',
                        overflowX: 'auto',
                        paddingBottom: '8px'
                      }}
                    >
                      {ESCALA_TERMICA_CUIDAI
                        .filter((faixa, indice) => {
                          const proximaFaixa =
                            ESCALA_TERMICA_CUIDAI[indice + 1];

                          const limiteSuperior =
                            proximaFaixa?.inicio ?? Infinity;

                          return (
                            escalaTermicaAtual.minimo < limiteSuperior &&
                            escalaTermicaAtual.maximo >= faixa.inicio
                          );
                        })
                        .map(faixa => (
                          <div
                            key={faixa.rotulo}
                            style={{
                              flex: '1 0 100px',
                              minWidth: '100px'
                            }}
                          >
                            <div
                              style={{
                                height: '17px',
                                borderRadius: '5px',
                                backgroundColor: faixa.hex
                              }}
                            />

                            <span
                              style={{
                                display: 'block',
                                marginTop: '6px',
                                color: '#64748B',
                                fontSize: '10px',
                                fontWeight: '700',
                                textAlign: 'center'
                              }}
                            >
                              {faixa.rotulo}
                            </span>
                          </div>
                        ))}
                    </div>
                  ) : (
                    <span style={{ color: '#64748B', fontSize: '12px' }}>
                      Aguardando temperaturas da Open-Meteo...
                    </span>
                  )}

                  <p
                    style={{
                      fontSize: '11px',
                      color: '#8E8E93',
                      margin: '10px 0 0'
                    }}
                  >
                    Escala fixa de 2 °C, do azul ao vermelho.
                    As cores são personalizáveis e não alteram
                    os valores de temperatura.
                  </p>
                </div>



                {/* VARIAÇÃO OBSERVADA NA GRADE OPEN-METEO */}
                {pontosGradeTermica.length > 0 && (
                  <div
                    style={{
                      marginTop: '14px',
                      padding: '10px 14px',
                      backgroundColor: '#FFFFFF',
                      border: '1px solid #E5ECF4',
                      borderRadius: '12px',
                      color: '#214563',
                      fontSize: '12px'
                    }}
                  >
                    <strong>Temperaturas estimadas na grade:</strong>{' '}
                    {Math.min(
                      ...pontosGradeTermica.map(p => p.temperatura)
                    ).toFixed(1)} °C
                    {' até '}
                    {Math.max(
                      ...pontosGradeTermica.map(p => p.temperatura)
                    ).toFixed(1)} °C

                    <span
                      style={{
                        display: 'block',
                        color: '#8E8E93',
                        marginTop: '4px'
                      }}
                    >
                      {pontosGradeTermica.length} pontos consultados no Ceará e entorno.
                    </span>
                  </div>
                )}


                <p
                  style={{
                    color: '#8E8E93',
                    fontSize: '11px',
                    lineHeight: '1.5',
                    margin: '12px 0 0'
                  }}
                >
                  Escala fixa de temperatura, com faixas de 2 °C.
                  As cores são aplicadas com transparência para
                  preservar os detalhes geográficos.
                  {' '}Fonte:{' '}
                  <a
                    href="https://open-meteo.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: '#168FC4' }}
                  >
                    Open-Meteo
                  </a>.
                </p>
              </div>



              {/* IDENTIFICAÇÃO DO TERRITÓRIO SELECIONADO */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flexWrap: 'wrap',
                  gap: '12px',
                  padding: '14px 18px',
                  marginBottom: '12px',
                  borderRadius: '14px',
                  background: '#EFF6FD',
                  border: '1px solid #DCE8F3'
                }}
              >
                <div>
                  <strong
                    style={{
                      display: 'block',
                      fontSize: '14px',
                      color: '#214563'
                    }}
                  >
                    {municipioSelecionado
                      ? `${municipioSelecionado.nome} — CE`
                      : 'Ceará — Visão territorial'}
                  </strong>

                  <span
                    style={{
                      color: '#64748B',
                      fontSize: '12px'
                    }}
                  >
                    {municipioSelecionado
                      ? 'Município selecionado para investigação'
                      : 'Clique em um município para investigar'}
                  </span>
                </div>

                {municipioSelecionado && (
                  <button
                    type="button"
                    onClick={() => setMunicipioSelecionado(null)}
                    style={{
                      border: '1px solid #BED8EF',
                      background: '#FFFFFF',
                      borderRadius: '10px',
                      padding: '9px 12px',
                      color: '#087CDB',
                      fontWeight: '700',
                      cursor: 'pointer'
                    }}
                  >
                    Limpar seleção
                  </button>
                )}
              </div>


              <div
                style={{
                  height: isMobile ? '400px' : '500px',
                  borderRadius: '16px',
                  overflow: 'hidden'
                }}
              >
                <MapContainer
                  center={minhaLocalizacao}
                  zoom={15}
                  style={{ height: '100%', width: '100%' }}
                >
                  {/* MAPA-BASE SEM NOMES */}
                  <TileLayer
                    url={`https://{s}.basemaps.cartocdn.com/rastertiles/voyager_nolabels/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_KEY}`}
                    subdomains="abcd"
                    attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                  />

                  {/* CAMADA COLORIDA RECORTADA PELO CEARÁ */}
                  {mostrarGradeTermica &&
                    pontosGradeTermica.length > 0 &&
                    poligonosCeara.length > 0 && (
                      <CamadaTemperaturaRegional
                        pontos={pontosGradeTermica}
                        poligonosCeara={poligonosCeara}
                        gradeLocalDisponivel={pontosGradeLocal.length === 25}
                      />
                    )}

                  {/* CAMADA DE TEMPERATURA PARA VISÃO LOCAL */}
                  {mostrarGradeTermica &&
                    pontosGradeLocal.length === 25 &&
                    poligonosCeara.length > 0 && (
                      <CamadaTemperaturaLocal
                        pontos={pontosGradeLocal}
                        poligonosCeara={poligonosCeara}
                      />
                    )}

                  {/* AJUSTE LOCAL AUTOMÁTICO DAS ESTAÇÕES CUIDAÍ */}
                  {mostrarGradeTermica &&
                    pontosGradeTermica.length === TOTAL_PONTOS_GRADE_TERMICA &&
                    estacoesAptasHibrido.length > 0 && (
                      <CamadaAjusteLocalCuidai
                        pontos={pontosGradeTermica}
                        estacoes={estacoesAptasHibrido}
                      />
                    )}

                  {/* NOMES DAS CIDADES E RUAS ACIMA DAS CORES */}
                  <Pane
                    name="rotulos-meteorologia"
                    style={{
                      zIndex: 450,
                      pointerEvents: 'none'
                    }}
                  >
                    <TileLayer
                      url={`https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}.png?key=${import.meta.env.VITE_CARTO_KEY}`}
                      subdomains="abcd"
                      attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                    />
                  </Pane>

                  {/* SELEÇÃO DE LOCAL PARA CONSULTA OPEN-METEO */}

                  {/* SELEÇÃO DE MUNICÍPIOS — TERRITÓRIO EM FOCO */}
                  {municipiosGeoJson && (
                    <CamadaMunicipiosCuidai
                      dados={municipiosGeoJson}
                      selecionado={municipioSelecionado}
                      onSelecionar={(municipio, latitude, longitude) => {
                        setMunicipioSelecionado(municipio);

                        // Atualiza a estimativa para o ponto clicado.
                        setPontoOpenMeteo({
                          latitude,
                          longitude
                        });
                      }}
                    />
                  )}

                  {/* CONSULTA LIVRE CASO A MALHA NÃO CARREGUE */}
                  {!municipiosGeoJson && (
                    <SelecionarPontoOpenMeteo
                      onSelecionar={(latitude, longitude) => {
                        setPontoOpenMeteo({ latitude, longitude });
                      }}
                    />
                  )}


                  {/* MARCADOR DO PONTO CONSULTADO */}
                  <CircleMarker
                    center={[
                      pontoOpenMeteo.latitude,
                      pontoOpenMeteo.longitude
                    ]}
                    radius={7}
                    pathOptions={{
                      color: '#214563',
                      fillColor: '#FFFFFF',
                      fillOpacity: 1,
                      weight: 3
                    }}
                  >

                    <Popup>
                      <div
                        style={{
                          minWidth: '220px',
                          padding: '5px',
                          fontFamily: 'inherit'
                        }}
                      >
                        <strong
                          style={{
                            display: 'block',
                            color: '#214563',
                            fontSize: '14px',
                            marginBottom: '12px'
                          }}
                        >
                          Condições meteorológicas
                        </strong>

                        {carregandoOpenMeteo ? (
                          <span style={{ color: '#64748B', fontSize: '12px' }}>
                            Consultando Open-Meteo...
                          </span>
                        ) : erroOpenMeteo ? (
                          <span style={{ color: '#B42318', fontSize: '12px' }}>
                            {erroOpenMeteo}
                          </span>
                        ) : dadosOpenMeteo ? (
                          <>
                            <div
                              style={{
                                fontSize: '28px',
                                fontWeight: '800',
                                color: '#E58047',
                                marginBottom: '12px'
                              }}
                            >
                              {dadosOpenMeteo.temperatura
                                .toFixed(1)
                                .replace('.', ',')} °C
                            </div>

                            <div
                              style={{
                                display: 'grid',
                                gridTemplateColumns: '1fr 1fr',
                                gap: '12px',
                                marginBottom: '12px'
                              }}
                            >
                              <div>
                                <span
                                  style={{
                                    display: 'block',
                                    color: '#8E8E93',
                                    fontSize: '11px'
                                  }}
                                >
                                  Sensação térmica
                                </span>
                                <strong style={{ color: '#214563' }}>
                                  {dadosOpenMeteo.sensacao
                                    .toFixed(1)
                                    .replace('.', ',')} °C
                                </strong>
                              </div>

                              <div>
                                <span
                                  style={{
                                    display: 'block',
                                    color: '#8E8E93',
                                    fontSize: '11px'
                                  }}
                                >
                                  Umidade
                                </span>
                                <strong style={{ color: '#168FC4' }}>
                                  {dadosOpenMeteo.umidade.toFixed(0)}%
                                </strong>
                              </div>
                            </div>

                            <div
                              style={{
                                borderTop: '1px solid #E5ECF4',
                                paddingTop: '9px',
                                color: '#64748B',
                                fontSize: '11px'
                              }}
                            >
                              Vento: {dadosOpenMeteo.vento.toFixed(1)} km/h
                              <div style={{ marginTop: '5px' }}>
                                Referência: {dadosOpenMeteo.horario.replace('T', ' às ')}
                              </div>
                            </div>
                          </>
                        ) : (
                          <span style={{ fontSize: '12px', color: '#64748B' }}>
                            Aguardando dados meteorológicos...
                          </span>
                        )}

                        <div
                          style={{
                            borderTop: '1px solid #E5ECF4',
                            marginTop: '12px',
                            paddingTop: '9px',
                            color: '#8E8E93',
                            fontSize: '10px'
                          }}
                        >
                          {pontoOpenMeteo.latitude.toFixed(4)},
                          {' '}
                          {pontoOpenMeteo.longitude.toFixed(4)}
                          <div style={{ marginTop: '4px' }}>
                            Fonte: Open-Meteo · Estimativa meteorológica
                          </div>
                        </div>
                      </div>
                    </Popup>

                  </CircleMarker>

                  {estacoesMeteo.map((estacao) => (
                    <Marker
                      key={estacao.id}
                      position={[estacao.latitude, estacao.longitude]}
                      icon={criarIconeVazado(
                        estacao.id === estacaoSelecionadaMeteo?.id
                          ? '#168FC4'
                          : '#64748B'
                      )}
                      eventHandlers={{
                        click: () => setIdEstacaoMeteo(estacao.id)
                      }}
                    >
                      <Popup>
                        <div style={{ minWidth: '180px' }}>
                          <strong>{estacao.nome}</strong>

                          <p style={{ margin: '6px 0' }}>
                            {estacao.municipio}
                          </p>

                          {estacao.ultimaLeitura ? (
                            <>
                              <div>
                                Temperatura: <strong>
                                  {estacao.ultimaLeitura.temperatura.toFixed(1)} °C
                                </strong>
                              </div>

                              <div>
                                Umidade: <strong>
                                  {estacao.ultimaLeitura.umidade.toFixed(0)}%
                                </strong>
                              </div>

                              <small>
                                Última leitura:{' '}
                                {new Date(
                                  estacao.ultimaLeitura.recebidoEm
                                ).toLocaleString('pt-BR')}
                              </small>
                            </>
                          ) : (
                            <p>Sem medição disponível.</p>
                          )}
                        </div>
                      </Popup>
                    </Marker>
                  ))}

                </MapContainer>
              </div>

              <span
                style={{
                  fontSize: '12px',
                  color: '#8E8E93'
                }}
              >
                A camada colorida representa estimativas regionais da
                Open-Meteo. Os marcadores das estações CUIDAÍ indicam
                locais de medições físicas, apresentados separadamente.
              </span>
            </div>

            {/* HISTÓRICO METEOROLÓGICO */}
            <div style={{ ...cardStyle, gap: '20px' }}>
              <div>
                <h2
                  style={{
                    margin: '0 0 6px',
                    fontSize: '19px',
                    color: '#1C1C1E',
                    fontWeight: '800'
                  }}
                >
                  Histórico meteorológico
                </h2>

                <p
                  style={{
                    margin: 0,
                    color: '#8E8E93',
                    fontSize: '12px'
                  }}
                >
                  Evolução das últimas 72 leituras armazenadas
                  da estação selecionada.
                </p>

                {/* RESUMO DO HISTÓRICO */}
                {historicoMeteo.length > 0 && (
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      alignItems: 'center',
                      gap: '10px',
                      marginTop: '18px'
                    }}
                  >
                    <span
                      style={{
                        padding: '9px 14px',
                        borderRadius: '12px',
                        backgroundColor: '#EAF5FF',
                        color: '#168FC4',
                        fontSize: '12px',
                        fontWeight: '800'
                      }}
                    >
                      {historicoMeteo.length} medições
                    </span>

                    <span
                      style={{
                        padding: '9px 14px',
                        borderRadius: '12px',
                        backgroundColor: '#F2F4F8',
                        color: '#214563',
                        fontSize: '12px',
                        fontWeight: '700'
                      }}
                    >
                      {estacaoSelecionadaMeteo?.nome || 'Estação CUIDAÍ'}
                    </span>

                    <span
                      style={{
                        padding: '9px 14px',
                        borderRadius: '12px',
                        backgroundColor: '#F2F4F8',
                        color: '#64748B',
                        fontSize: '12px'
                      }}
                    >
                      Dados observados pelo sensor
                    </span>
                  </div>
                )}
              </div>

              {erroHistoricoMeteo ? (
                <p style={{ color: '#B42318', fontSize: '13px' }}>
                  {erroHistoricoMeteo}
                </p>
              ) : carregandoHistoricoMeteo ? (
                <p style={{ color: '#8E8E93', fontSize: '13px' }}>
                  Carregando histórico meteorológico...
                </p>
              ) : historicoMeteo.length === 0 ? (
                <p style={{ color: '#8E8E93', fontSize: '13px' }}>
                  Ainda não há leituras históricas disponíveis
                  para esta estação.
                </p>
              ) : (
                <>
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile
                        ? '1fr'
                        : 'repeat(2, minmax(0, 1fr))',
                      gap: '24px'
                    }}
                  >
                    {[
                      {
                        titulo: 'Temperatura',
                        chave: 'temperatura',
                        cor: '#E58047',
                        unidade: '°C'
                      },
                      {
                        titulo: 'Umidade relativa',
                        chave: 'umidade',
                        cor: '#168FC4',
                        unidade: '%'
                      }
                    ].map((grafico) => (
                      <div
                        key={grafico.chave}
                        style={{
                          minWidth: 0,
                          padding: isMobile ? '16px' : '22px',
                          backgroundColor: '#F8FAFD',
                          border: '1px solid #E5ECF4',
                          borderRadius: '22px',
                          boxShadow: '0 6px 18px rgba(33, 69, 99, 0.04)'
                        }}
                      >
                        <div
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '12px',
                            marginBottom: '20px'
                          }}
                        >
                          <div
                            style={{
                              width: '10px',
                              height: '10px',
                              borderRadius: '50%',
                              backgroundColor: grafico.cor,
                              flexShrink: 0
                            }}
                          />

                          <div>
                            <h3
                              style={{
                                fontSize: '16px',
                                color: '#1C1C1E',
                                fontWeight: '800',
                                margin: 0
                              }}
                            >
                              {grafico.titulo}
                            </h3>

                            <span
                              style={{
                                fontSize: '11px',
                                color: '#8E8E93',
                                display: 'block',
                                marginTop: '4px'
                              }}
                            >
                              Evolução das medições registradas
                            </span>
                          </div>
                        </div>

                        <div style={{ height: '260px', width: '100%' }}>
                          <ResponsiveContainer
                            width="100%"
                            height="100%"
                          >
                            <AreaChart
                              data={historicoMeteo}
                              margin={{
                                top: 12,
                                right: 16,
                                left: 12,
                                bottom: 12
                              }}
                            >
                              <CartesianGrid
                                strokeDasharray="3 3"
                                stroke="#E5E5EA"
                                vertical={false}
                              />

                              <XAxis
                                dataKey="momento"
                                tick={{ fontSize: 10 }}
                                minTickGap={30}
                                interval="preserveStartEnd"
                              />

                              <YAxis
                                tick={{
                                  fontSize: 10,
                                  fill: '#64748B'
                                }}
                                width={72}
                                tickMargin={6}
                                axisLine={false}
                                tickLine={false}
                                domain={['auto', 'auto']}
                                tickFormatter={(valor: number) =>
                                  grafico.chave === 'temperatura'
                                    ? `${Number(valor).toLocaleString('pt-BR', {
                                      maximumFractionDigits: 1
                                    })}°C`
                                    : `${Math.round(Number(valor))}%`
                                }
                              />

                              <Tooltip
                                formatter={(valor: any) => [
                                  `${Number(valor).toLocaleString('pt-BR', {
                                    maximumFractionDigits: 1
                                  })} ${grafico.unidade}`,
                                  grafico.titulo
                                ]}
                                contentStyle={{
                                  backgroundColor: '#FFFFFF',
                                  border: '1px solid #E5ECF4',
                                  borderRadius: '14px',
                                  padding: '12px',
                                  boxShadow: '0 8px 25px rgba(33, 69, 99, 0.12)',
                                  fontSize: '12px'
                                }}
                              />

                              <Area
                                type="linear"
                                dataKey={grafico.chave}
                                stroke={grafico.cor}
                                strokeWidth={3}
                                fill={grafico.cor}
                                fillOpacity={0.10}
                                dot={
                                  historicoMeteo.length <= 15
                                    ? { r: 3 }
                                    : false
                                }
                                activeDot={{ r: 5 }}
                                isAnimationActive={false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* RODAPÉ DO HISTÓRICO */}
                  <div
                    style={{
                      display: 'flex',
                      flexWrap: 'wrap',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      gap: '16px',
                      paddingTop: '18px',
                      marginTop: '4px',
                      borderTop: '1px solid #E5ECF4'
                    }}
                  >
                    <div>
                      <span
                        style={{
                          display: 'block',
                          color: '#8E8E93',
                          fontSize: '11px',
                          fontWeight: '700',
                          marginBottom: '5px'
                        }}
                      >
                        PERÍODO ANALISADO
                      </span>

                      <strong
                        style={{
                          color: '#214563',
                          fontSize: '12px'
                        }}
                      >
                        {new Date(
                          historicoMeteo[0].recebidoEm
                        ).toLocaleString('pt-BR')}
                        {' — '}
                        {new Date(
                          historicoMeteo[
                            historicoMeteo.length - 1
                          ].recebidoEm
                        ).toLocaleString('pt-BR')}
                      </strong>
                    </div>

                    <div
                      style={{
                        fontSize: '11px',
                        color: '#64748B',
                        backgroundColor: '#F2F6FA',
                        padding: '9px 12px',
                        borderRadius: '10px'
                      }}
                    >
                      Fonte: Estação CUIDAÍ · Firebase
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {abaAtiva === 'mapa_calor' && (
          /* =================== MAPA DE CALOR COM FILTROS =================== */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div
              style={{
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                justifyContent: 'space-between',
                alignItems: isMobile ? 'flex-start' : 'center',
                gap: isMobile ? '12px' : '0',
                marginBottom: '24px'
              }}
            >
              <h1
                style={{
                  color: '#1C1C1E',
                  fontSize: isMobile ? '24px' : '28px',
                  fontWeight: '700',
                  margin: 0
                }}
              >
                Mapa de Calor
              </h1>

              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: isMobile ? 'flex-start' : 'flex-end',
                  gap: '7px'
                }}
              >
                <button
                  onClick={() => setInfoMapaCalorAberta(true)}
                  style={{
                    border: 'none',
                    backgroundColor: '#FFFFFF',
                    color: '#007AFF',
                    padding: '7px 11px',
                    borderRadius: '10px',
                    cursor: 'pointer',
                    fontSize: '12px',
                    fontWeight: '700',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.07)'
                  }}
                >
                  <FaInfoCircle size={14} />
                  Como interpretar o mapa?
                </button>

                <span
                  style={{
                    color: '#8E8E93',
                    fontSize: '10px',
                    fontWeight: '600'
                  }}
                >
                  Mostrando {alertasParaOMapa.length} ocorrências
                </span>
              </div>
            </div>

            {infoMapaCalorAberta && (
              <div
                onClick={() => setInfoMapaCalorAberta(false)}
                style={{
                  position: 'fixed',
                  top: 0,
                  left: 0,
                  width: '100vw',
                  height: '100vh',
                  backgroundColor: 'rgba(0,0,0,0.35)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  zIndex: 20000,
                  padding: '16px',
                  boxSizing: 'border-box'
                }}
              >
                <div
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    width: isMobile ? '100%' : '520px',
                    maxWidth: '520px',
                    maxHeight: '82vh',
                    overflowY: 'auto',
                    backgroundColor: '#FFFFFF',
                    borderRadius: '22px',
                    padding: isMobile ? '22px' : '28px',
                    boxShadow: '0 20px 60px rgba(0,0,0,0.22)',
                    position: 'relative'
                  }}
                >

                  <button
                    onClick={() => setInfoMapaCalorAberta(false)}
                    style={{
                      position: 'absolute',
                      top: '16px',
                      right: '16px',
                      width: '34px',
                      height: '34px',
                      borderRadius: '50%',
                      border: 'none',
                      backgroundColor: '#F2F2F7',
                      color: '#636366',
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center'
                    }}
                  >
                    <MdClose size={19} />
                  </button>

                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      borderRadius: '12px',
                      backgroundColor: '#EAF5FF',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '14px'
                    }}
                  >
                    <FaInfoCircle size={20} color="#007AFF" />
                  </div>

                  <h2
                    style={{
                      color: '#1C1C1E',
                      fontSize: '20px',
                      margin: '0 40px 20px 0'
                    }}
                  >
                    Como interpretar o Mapa de Calor?
                  </h2>

                  <div style={{ marginBottom: '18px' }}>
                    <strong
                      style={{
                        display: 'block',
                        color: '#1C1C1E',
                        fontSize: '14px',
                        marginBottom: '5px'
                      }}
                    >
                      O que este mapa mostra?
                    </strong>

                    <p
                      style={{
                        margin: 0,
                        color: '#6E6E73',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        textAlign: 'justify'
                      }}
                    >
                      O mapa mostra onde estão concentradas as ocorrências ativas
                      registradas pela comunidade por meio do CUIDAÍ.
                    </p>
                  </div>

                  <div style={{ marginBottom: '18px' }}>
                    <strong
                      style={{
                        display: 'block',
                        color: '#1C1C1E',
                        fontSize: '14px',
                        marginBottom: '5px'
                      }}
                    >
                      Como interpretar as cores?
                    </strong>

                    <p
                      style={{
                        margin: 0,
                        color: '#6E6E73',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        textAlign: 'justify'
                      }}
                    >
                      Quanto mais intensa a cor, maior é a concentração de registros
                      próximos uns dos outros naquela região. Cores menos intensas
                      indicam uma menor concentração.
                    </p>
                  </div>

                  <div style={{ marginBottom: '18px' }}>
                    <strong
                      style={{
                        display: 'block',
                        color: '#1C1C1E',
                        fontSize: '14px',
                        marginBottom: '5px'
                      }}
                    >
                      O que significa “Mostrando X ocorrências”?
                    </strong>

                    <p
                      style={{
                        margin: 0,
                        color: '#6E6E73',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        textAlign: 'justify'
                      }}
                    >
                      É a quantidade de ocorrências ativas que estão sendo consideradas
                      para formar o mapa de calor naquele momento.
                    </p>
                  </div>

                  <div style={{ marginBottom: '18px' }}>
                    <strong
                      style={{
                        display: 'block',
                        color: '#1C1C1E',
                        fontSize: '14px',
                        marginBottom: '5px'
                      }}
                    >
                      Para que servem os filtros?
                    </strong>

                    <p
                      style={{
                        margin: 0,
                        color: '#6E6E73',
                        fontSize: '13px',
                        lineHeight: '1.6',
                        textAlign: 'justify'
                      }}
                    >
                      Os filtros permitem visualizar somente uma categoria de ocorrência.
                      Ao selecionar “Todas”, o mapa considera todas as categorias ativas.
                    </p>
                  </div>

                  <div
                    style={{
                      backgroundColor: '#F2F2F7',
                      borderRadius: '14px',
                      padding: '14px 16px'
                    }}
                  >
                    <strong
                      style={{
                        display: 'block',
                        color: '#214563',
                        fontSize: '13px',
                        marginBottom: '5px'
                      }}
                    >
                      Importante
                    </strong>

                    <span
                      style={{
                        display: 'block',
                        color: '#5E5E63',
                        fontSize: '12px',
                        lineHeight: '1.55'
                      }}
                    >
                      Uma cor mais intensa indica mais registros próximos entre si.
                      Ela não indica, necessariamente, que uma ocorrência é mais grave
                      do que outra.
                    </span>
                  </div>

                </div>
              </div>
            )}

            <div style={{ ...cardStyle, flex: 1, padding: 0, overflow: 'hidden', position: 'relative', minHeight: isMobile ? '500px' : 'auto' }}>
              <div style={{ position: 'absolute', top: isMobile ? 10 : 20, left: isMobile ? 10 : 60, zIndex: 1000, display: 'flex', gap: '8px', flexWrap: 'wrap', maxWidth: isMobile ? '90%' : '60%' }}>
                <button onClick={() => setFiltroCalor('Todas')} style={{ padding: '8px 16px', border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', backgroundColor: filtroCalor === 'Todas' ? '#1C1C1E' : 'rgba(255,255,255,0.9)', color: filtroCalor === 'Todas' ? 'white' : '#8E8E93', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Todas</button>
                {categoriasUnicas.map(categoria => <button key={categoria} onClick={() => setFiltroCalor(categoria as string)} style={{ padding: '8px 16px', border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', backgroundColor: filtroCalor === categoria ? '#007AFF' : 'rgba(255,255,255,0.9)', color: filtroCalor === categoria ? 'white' : '#8E8E93', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>{categoria as string}</button>)}
              </div>

              <div style={{ position: 'absolute', bottom: isMobile ? 20 : 'auto', top: isMobile ? 'auto' : 20, right: isMobile ? '50%' : 20, transform: isMobile ? 'translateX(50%)' : 'none', zIndex: 1000, backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', padding: '16px', borderRadius: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                <strong style={{ display: 'block', marginBottom: '12px', fontSize: '14px', textAlign: 'center' }}>Concentração de registros</strong>
                <div style={{ width: '200px', height: '14px', borderRadius: '8px', background: cssLegenda }}></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: '20px', marginTop: '7px', fontSize: '10px', color: '#8E8E93', fontWeight: '600' }}>
                  <span style={{ whiteSpace: 'nowrap' }}>Menor concentração</span>
                  <span style={{ whiteSpace: 'nowrap' }}>Maior concentração</span></div>
              </div>



              <MapContainer
                center={minhaLocalizacao}
                zoom={14}
                style={{
                  height: '100%',
                  width: '100%',
                  zIndex: 1,
                  backgroundColor: '#FFFFFF'
                }}
              >
                <TileLayer
                  className="mapa-cuidai"
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />


                <CamadaCalor
                  alertas={alertasParaOMapa}
                  gradiente={gradienteAtual}
                />
              </MapContainer>
            </div>
          </div>
        )}



        {abaAtiva === 'sobre' && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              minHeight: '100%',
              gap: '24px'
            }}
          >

            {/* CABEÇALHO */}
            <div>
              <h1
                style={{
                  color: '#1C1C1E',
                  margin: 0,
                  fontSize: isMobile ? '24px' : '28px',
                  fontWeight: '700'
                }}
              >
                Sobre o Projeto
              </h1>

              <p
                style={{
                  color: '#8E8E93',
                  fontSize: '14px',
                  marginTop: '6px'
                }}
              >
                Tecnologia, território e participação comunitária.
              </p>
            </div>


            {/* CONTEÚDO PRINCIPAL */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: isMobile ? '1fr' : '3fr 1fr',
                gap: '24px',
                flex: 1
              }}
            >

              {/* ================= COLUNA PRINCIPAL ================= */}
              <div
                style={{
                  ...cardStyle,
                  justifyContent: 'flex-start',
                  gap: '28px'
                }}
              >

                {/* IDENTIDADE DO PROJETO */}
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '16px'
                  }}
                >
                  <img
                    src="/logonovopainel.png"
                    alt="Logo do CUIDAÍ"
                    style={{
                      width: '72px',
                      height: '72px',
                      objectFit: 'contain'
                    }}
                  />

                  <div>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '6px'
                      }}
                    >
                      <strong
                        style={{
                          fontSize: '25px',
                          color: '#1C1C1E'
                        }}
                      >
                        Cuidaí
                      </strong>

                      <span
                        style={{
                          fontSize: '11px',
                          fontWeight: '800',
                          color: '#007AFF',
                          textTransform: 'uppercase'
                        }}
                      >
                        Ecossistema Digital
                      </span>
                    </div>

                    <span
                      style={{
                        fontSize: '13px',
                        color: '#8E8E93'
                      }}
                    >
                      O Sertão cuida junto.
                    </span>
                  </div>
                </div>


                {/* O QUE É O CUIDAÍ */}
                <div>
                  <h2
                    style={{
                      color: '#007AFF',
                      fontSize: '17px',
                      margin: '0 0 8px'
                    }}
                  >
                    O que é o CUIDAÍ App?
                  </h2>

                  <p
                    style={{
                      color: '#1C1C1E',
                      lineHeight: '1.7',
                      fontSize: '13px',
                      margin: 0,
                      textAlign: 'justify'
                    }}
                  >
                    O <strong>CUIDAÍ</strong> é um aplicativo móvel colaborativo
                    criado para apoiar a comunicação comunitária durante o período
                    chuvoso. Por meio dele, os usuários podem registrar ocorrências
                    georreferenciadas relacionadas a chuvas, passagens, energia e
                    condições das estradas, consultar alertas próximos e contribuir
                    com informações sobre a continuidade ou resolução das situações
                    registradas.
                  </p>
                </div>


                {/* O QUE É O PAINEL */}
                <div>
                  <h2
                    style={{
                      color: '#007AFF',
                      fontSize: '17px',
                      margin: '0 0 8px',

                    }}
                  >
                    O que é o CUIDAÍ Painel?
                  </h2>

                  <p
                    style={{
                      color: '#1C1C1E',
                      lineHeight: '1.7',
                      fontSize: '13px',
                      margin: 0,
                      textAlign: 'justify'

                    }}
                  >
                    O <strong>CUIDAÍ Painel</strong> é o ambiente web de
                    acompanhamento e análise dos dados produzidos pelo aplicativo.
                    Conectado à mesma base de dados, organiza os registros em
                    indicadores, gráficos, mapas, concentração espacial de
                    ocorrências e informações recentes, facilitando a visualização
                    do que está acontecendo no território.
                  </p>
                </div>


                {/* COMO FUNCIONA */}
                <div>
                  <h2
                    style={{
                      color: '#007AFF',
                      fontSize: '17px',
                      margin: '0 0 14px'
                    }}
                  >
                    Como o ecossistema funciona?
                  </h2>

                  <div
                    style={{
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: isMobile ? '10px' : '12px',
                      backgroundColor: '#F7F8FA',
                      borderRadius: '16px',
                      padding: '18px'
                    }}
                  >

                    {/* ETAPA 01 */}
                    <div
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        minWidth: 0
                      }}
                    >
                      <div
                        style={{
                          color: '#007AFF',
                          fontSize: '20px',
                          fontWeight: '800',
                          marginBottom: '5px'
                        }}
                      >
                        01
                      </div>

                      <div
                        style={{
                          color: '#1C1C1E',
                          fontSize: '13px',
                          fontWeight: '800',
                          marginBottom: '4px'
                        }}
                      >
                        A comunidade registra
                      </div>

                      <div
                        style={{
                          color: '#8E8E93',
                          fontSize: '12px',
                          lineHeight: '1.45'
                        }}
                      >
                        A ocorrência é registrada no aplicativo.
                      </div>
                    </div>

                    {/* SETA */}
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: '#EAF5FF',
                        color: '#007AFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transform: isMobile ? 'rotate(90deg)' : 'none'
                      }}
                    >
                      <MdArrowForward size={21} />
                    </div>

                    {/* ETAPA 02 */}
                    <div
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        minWidth: 0
                      }}
                    >
                      <div
                        style={{
                          color: '#007AFF',
                          fontSize: '20px',
                          fontWeight: '800',
                          marginBottom: '5px'
                        }}
                      >
                        02
                      </div>

                      <div
                        style={{
                          color: '#1C1C1E',
                          fontSize: '13px',
                          fontWeight: '800',
                          marginBottom: '4px'
                        }}
                      >
                        A informação é compartilhada
                      </div>

                      <div
                        style={{
                          color: '#8E8E93',
                          fontSize: '12px',
                          lineHeight: '1.45'
                        }}
                      >
                        Os registros ficam disponíveis para acompanhamento.
                      </div>
                    </div>

                    {/* SETA */}
                    <div
                      style={{
                        width: '36px',
                        height: '36px',
                        borderRadius: '50%',
                        backgroundColor: '#EAF5FF',
                        color: '#007AFF',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        flexShrink: 0,
                        transform: isMobile ? 'rotate(90deg)' : 'none'
                      }}
                    >
                      <MdArrowForward size={21} />
                    </div>

                    {/* ETAPA 03 */}
                    <div
                      style={{
                        flex: 1,
                        textAlign: 'center',
                        minWidth: 0
                      }}
                    >
                      <div
                        style={{
                          color: '#007AFF',
                          fontSize: '20px',
                          fontWeight: '800',
                          marginBottom: '5px'
                        }}
                      >
                        03
                      </div>

                      <div
                        style={{
                          color: '#1C1C1E',
                          fontSize: '13px',
                          fontWeight: '800',
                          marginBottom: '4px'
                        }}
                      >
                        O painel organiza
                      </div>

                      <div
                        style={{
                          color: '#8E8E93',
                          fontSize: '12px',
                          lineHeight: '1.45'
                        }}
                      >
                        Mapas, gráficos e indicadores apresentam os dados.
                      </div>
                    </div>

                  </div>
                </div>





                {/* CRÉDITOS */}
                <div
                  style={{
                    borderTop: '1px solid #E5E5EA',
                    paddingTop: '24px'
                  }}
                >
                  <h2
                    style={{
                      color: '#1C1C1E',
                      fontSize: '17px',
                      margin: '0 0 5px'
                    }}
                  >
                    Desenvolvido por
                  </h2>

                  <p
                    style={{
                      color: '#8E8E93',
                      fontSize: '12px',
                      margin: '0 0 18px',
                      lineHeight: '1.5'
                    }}
                  >
                    CUIDAÍ: ecossistema digital colaborativo de alertas e
                    informações no período chuvoso
                  </p>




                  {/* ESTUDANTES + ORIENTAÇÃO */}
                  <div
                    style={{
                      display: 'grid',
                      gridTemplateColumns: isMobile
                        ? '1fr'
                        : 'repeat(3, 1fr)',
                      gap: '14px',
                      marginBottom: '28px'
                    }}
                  >

                    <div
                      style={{
                        backgroundColor: '#F7F8FA',
                        padding: '15px',
                        borderRadius: '14px'
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          color: '#007AFF',
                          fontSize: '11px',
                          fontWeight: '800',
                          textTransform: 'uppercase',
                          marginBottom: '7px'
                        }}
                      >
                        Estudantes
                      </span>

                      <strong
                        style={{
                          display: 'block',
                          color: '#1C1C1E',
                          fontSize: '13px'
                        }}
                      >
                        Ryanne M. S. Aranha
                      </strong>

                      <strong
                        style={{
                          display: 'block',
                          color: '#1C1C1E',
                          fontSize: '13px',
                          marginTop: '5px'
                        }}
                      >
                        Anderson V. Sabino
                      </strong>
                    </div>


                    <div
                      style={{
                        backgroundColor: '#F7F8FA',
                        padding: '15px',
                        borderRadius: '14px'
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          color: '#007AFF',
                          fontSize: '11px',
                          fontWeight: '800',
                          textTransform: 'uppercase',
                          marginBottom: '7px'
                        }}
                      >
                        Orientação
                      </span>

                      <strong
                        style={{
                          display: 'block',
                          color: '#1C1C1E',
                          fontSize: '13px',
                          lineHeight: '1.4'
                        }}
                      >
                        Prof.ª Ma. Emilly Tábara A. C. Quadro
                      </strong>
                    </div>


                    <div
                      style={{
                        backgroundColor: '#F7F8FA',
                        padding: '15px',
                        borderRadius: '14px'
                      }}
                    >
                      <span
                        style={{
                          display: 'block',
                          color: '#007AFF',
                          fontSize: '11px',
                          fontWeight: '800',
                          textTransform: 'uppercase',
                          marginBottom: '7px'
                        }}
                      >
                        Coorientação
                      </span>

                      <strong
                        style={{
                          display: 'block',
                          color: '#1C1C1E',
                          fontSize: '13px',
                          lineHeight: '1.4'
                        }}
                      >
                        Prof. Esp. Israel P. de Quadro
                      </strong>
                    </div>

                  </div>



                  {/* INSTITUIÇÃO */}
                  <div
                    style={{
                      marginTop: '20px',
                      paddingTop: '20px',
                      borderTop: '1px solid #EEEEEE',
                      display: 'flex',
                      flexDirection: isMobile ? 'column' : 'row',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: '20px'
                    }}
                  >

                    <div
                      style={{
                        textAlign: isMobile ? 'center' : 'left'
                      }}
                    >
                      <strong
                        style={{
                          display: 'block',
                          color: '#1C1C1E',
                          fontSize: '14px'
                        }}
                      >

                      </strong>

                      <span
                        style={{
                          display: 'block',
                          color: '#8E8E93',
                          fontSize: '12px',
                          marginTop: '4px'
                        }}
                      >

                      </span>
                    </div>


                    {/* LOGOS INSTITUCIONAIS */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '24px',
                        flexWrap: 'wrap'
                      }}
                    >

                      <img
                        src="/LOGONMVP.png"
                        alt="EEMTI Maria Vieira de Pinho"
                        style={{
                          maxWidth: '130px',
                          maxHeight: '60px',
                          objectFit: 'contain',
                          backgroundColor: 'transparent'
                        }}
                      />

                      <img
                        src="/logoce.png"
                        alt="Governo do Estado do Ceará"
                        style={{
                          maxWidth: '150px',
                          maxHeight: '60px',
                          objectFit: 'contain'
                        }}
                      />

                    </div>
                  </div>

                </div>
              </div>


              {/* ================= COLUNA DIREITA ================= */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '18px'
                }}
              >

                {/* DOWNLOAD */}
                <div
                  style={{
                    ...cardStyle,
                    justifyContent: 'center',
                    alignItems: 'center',
                    gap: '10px',
                    textAlign: 'center'
                  }}
                >


                  <img
                    src="/logonovoapp.png"
                    alt="Logo do CUIDAÍ"
                    style={{
                      width: '60px',
                      height: '60px',
                      objectFit: 'contain',
                      marginTop: '2px'
                    }}
                  />

                  <h2
                    style={{
                      color: '#007AFF',
                      fontSize: '16px',
                      margin: 0
                    }}
                  >
                    Baixe o CUIDAÍ App
                  </h2>

                  <p
                    style={{
                      color: '#8E8E93',
                      fontSize: '10px',
                      lineHeight: '1.5',
                      margin: '0 0 4px',
                      maxWidth: '220px',
                    }}
                  >
                    Escaneie o QR Code para acessar a página oficial de download do
                    aplicativo.
                  </p>

                  <a
                    href="/baixar"
                    style={{
                      display: 'block',
                      textDecoration: 'none'
                    }}
                  >
                    <img
                      src="/qr-cuidai-baixar.png"
                      alt="QR Code para baixar o CUIDAÍ"
                      style={{
                        width: '160px',
                        height: '160px',
                        objectFit: 'contain',
                        borderRadius: '12px'
                      }}
                    />
                  </a>

                  <a
                    href="/baixar"
                    style={{
                      color: '#007AFF',
                      fontSize: '12px',
                      fontWeight: '700',
                      textDecoration: 'none',
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '5px'
                    }}
                  >
                    Abrir página de download
                    <MdArrowForward size={16} />
                  </a>
                </div>




                {/* TECNOLOGIAS - CARROSSEL */}
                <div
                  style={{
                    ...cardStyle,
                    padding: 0,
                    overflow: 'hidden',
                    justifyContent: 'flex-start'
                  }}
                >

                  {/* CABEÇALHO */}
                  <div
                    style={{
                      background: 'linear-gradient(135deg, #214563 0%, #152a3f 100%)',
                      padding: '8px 16px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px'
                    }}
                  >
                    <MdMemory
                      size={20}
                      color="#FFFFFF"
                    />

                    <h2
                      style={{
                        color: '#FFFFFF',
                        fontSize: '16px',
                        margin: 0,
                        fontWeight: '700'
                      }}
                    >
                      Tecnologias
                    </h2>
                  </div>


                  {/* CONTEÚDO DO CARROSSEL */}
                  <div
                    style={{
                      padding: '14px 16px 12px',
                      textAlign: 'center'
                    }}
                  >

                    <div
                      style={{
                        minHeight: '58px',
                        display: 'flex',
                        flexDirection: 'column',
                        justifyContent: 'center',
                        alignItems: 'center'
                      }}
                    >

                      <span
                        style={{
                          display: 'block',
                          color: '#007AFF',
                          fontSize: '11px',
                          fontWeight: '800',
                          textTransform: 'uppercase',
                          letterSpacing: '0.5px',
                          marginBottom: '9px'
                        }}
                      >
                        {tecnologias[tecnologiaAtual].titulo}
                      </span>

                      <strong
                        style={{
                          display: 'block',
                          color: '#1C1C1E',
                          fontSize: '15px',
                          lineHeight: '1.45'
                        }}
                      >
                        {tecnologias[tecnologiaAtual].descricao}
                      </strong>

                    </div>


                    {/* CONTROLES */}
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginTop: '5px'
                      }}
                    >

                      {/* SETA ESQUERDA */}
                      <button
                        onClick={() =>
                          setTecnologiaAtual((atual) =>
                            atual === 0
                              ? tecnologias.length - 1
                              : atual - 1
                          )
                        }
                        aria-label="Tecnologia anterior"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: 'none',
                          backgroundColor: '#F2F2F7',
                          color: '#214563',
                          fontSize: '18px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <MdArrowBack size={18} />
                      </button>


                      {/* PONTINHOS */}
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          gap: '6px'
                        }}
                      >
                        {tecnologias.map((_, index) => (
                          <button
                            key={index}
                            onClick={() => setTecnologiaAtual(index)}
                            aria-label={`Tecnologia ${index + 1}`}
                            style={{
                              width: tecnologiaAtual === index ? '18px' : '7px',
                              height: '7px',
                              borderRadius: '10px',
                              border: 'none',
                              padding: 0,
                              cursor: 'pointer',
                              backgroundColor:
                                tecnologiaAtual === index
                                  ? '#007AFF'
                                  : '#D1D1D6',
                              transition: 'all 0.25s ease'
                            }}
                          />
                        ))}
                      </div>


                      {/* SETA DIREITA */}
                      <button
                        onClick={() =>
                          setTecnologiaAtual((atual) =>
                            (atual + 1) % tecnologias.length
                          )
                        }
                        aria-label="Próxima tecnologia"
                        style={{
                          width: '32px',
                          height: '32px',
                          borderRadius: '50%',
                          border: 'none',
                          backgroundColor: '#F2F2F7',
                          color: '#214563',
                          fontSize: '18px',
                          fontWeight: '700',
                          cursor: 'pointer',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center'
                        }}
                      >
                        <MdArrowForward size={18} />
                      </button>

                    </div>
                  </div>
                </div>

              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}


export default App;