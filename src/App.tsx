import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { collection, onSnapshot } from 'firebase/firestore';
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

const CORES = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE'];

const GRADIENTES_CALOR: Record<string, any> = {
  'Chuvas': { 0.1: '#bae6fd', 0.39: '#bae6fd', 0.4: '#38bdf8', 0.59: '#38bdf8', 0.6: '#0284c7', 0.79: '#0284c7', 0.8: '#1d4ed8', 0.99: '#1d4ed8', 1.0: '#1e3a8a' },
  'Passagem': { 0.1: '#fef08a', 0.39: '#fef08a', 0.4: '#fbbf24', 0.59: '#fbbf24', 0.6: '#f97316', 0.79: '#f97316', 0.8: '#ea580c', 0.99: '#ea580c', 1.0: '#9a3412' },
  'Energia': { 0.1: '#e9d5ff', 0.39: '#e9d5ff', 0.4: '#c084fc', 0.59: '#c084fc', 0.6: '#a855f7', 0.79: '#a855f7', 0.8: '#7e22ce', 0.99: '#7e22ce', 1.0: '#4c1d95' },
  'Todas': { 0.1: 'rgba(0, 122, 255, 0.4)', 0.39: 'rgba(0, 122, 255, 0.4)', 0.4: 'cyan', 0.59: 'cyan', 0.6: 'lime', 0.79: 'lime', 0.8: 'orange', 0.99: 'orange', 1.0: 'red' },
  'Estrada': { 0.1: '#d9f99d', 0.39: '#d9f99d', 0.4: '#86efac', 0.59: '#86efac', 0.6: '#4ade80', 0.79: '#4ade80', 0.8: '#65a30d', 0.99: '#65a30d', 1.0: '#3f6212' },
};

const getGradiente = (filtro: string) => {
  if (filtro.includes('Chuva')) return GRADIENTES_CALOR['Chuvas'];
  if (filtro.includes('Passagem')) return GRADIENTES_CALOR['Passagem'];
  if (filtro.includes('Energia')) return GRADIENTES_CALOR['Energia'];
  if (filtro.includes('Estrada')) return GRADIENTES_CALOR['Estrada'];
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
  const [minhaLocalizacao, setMinhaLocalizacao] = useState<[number, number] | null>(null);
  const [carregamentoInicial, setCarregamentoInicial] = useState(true);
  const [abaAtiva, setAbaAtiva] = useState<'visao_geral' | 'mapa_calor' | 'sobre'>('visao_geral');
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

  useEffect(() => {
    navigator.geolocation.getCurrentPosition(
      (posicao) => setMinhaLocalizacao([posicao.coords.latitude, posicao.coords.longitude]),
      () => setMinhaLocalizacao([-7.2307, -39.4121])
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
                {['Todas', 'Chuvas', 'Passagem', 'Energia', 'Estrada'].map(categoria => (
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