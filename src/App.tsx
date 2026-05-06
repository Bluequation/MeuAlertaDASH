import { useEffect, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from './firebase';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, AreaChart, Area, CartesianGrid } from 'recharts';
import L, { divIcon } from 'leaflet'; 
import 'leaflet/dist/leaflet.css';
import 'leaflet.heat';

// 💡 IMPORTAÇÃO DOS ÍCONES (Adicionado MdMenu e MdClose)
import { MdSpaceDashboard, MdMenu, MdClose } from 'react-icons/md';      
import { AiOutlineHeatMap } from 'react-icons/ai';
import { FaDownload, FaInfoCircle } from 'react-icons/fa'; 
import { FaCircleNodes } from 'react-icons/fa6';        

interface Alerta {
  id: string;
  latitude: number;
  longitude: number;
  categoria: string;
  titulo: string;
  hora?: string;
  criadoEm?: number;
}

const CORES = ['#007AFF', '#34C759', '#FF9500', '#FF3B30', '#AF52DE'];

const GRADIENTES_CALOR: Record<string, any> = {
  'Chuvas': { 0.1: '#bae6fd', 0.39: '#bae6fd', 0.4: '#38bdf8', 0.59: '#38bdf8', 0.6: '#0284c7', 0.79: '#0284c7', 0.8: '#1d4ed8', 0.99: '#1d4ed8', 1.0: '#1e3a8a' },
  'Passagem': { 0.1: '#fef08a', 0.39: '#fef08a', 0.4: '#fbbf24', 0.59: '#fbbf24', 0.6: '#f97316', 0.79: '#f97316', 0.8: '#ea580c', 0.99: '#ea580c', 1.0: '#9a3412' },
  'Energia': { 0.1: '#e9d5ff', 0.39: '#e9d5ff', 0.4: '#c084fc', 0.59: '#c084fc', 0.6: '#a855f7', 0.79: '#a855f7', 0.8: '#7e22ce', 0.99: '#7e22ce', 1.0: '#4c1d95' },
  'Todas': { 0.1: 'rgba(0, 122, 255, 0.4)', 0.39: 'rgba(0, 122, 255, 0.4)', 0.4: 'cyan', 0.59: 'cyan', 0.6: 'lime', 0.79: 'lime', 0.8: 'orange', 0.99: 'orange', 1.0: 'red' }
};

const getGradiente = (filtro: string) => {
  if (filtro.includes('Chuva')) return GRADIENTES_CALOR['Chuvas'];
  if (filtro.includes('Passagem')) return GRADIENTES_CALOR['Passagem'];
  if (filtro.includes('Energia')) return GRADIENTES_CALOR['Energia'];
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

function App() {
  const [alertas, setAlertas] = useState<Alerta[]>([]);
  const [minhaLocalizacao, setMinhaLocalizacao] = useState<[number, number] | null>(null);
  const [abaAtiva, setAbaAtiva] = useState<'visao_geral' | 'mapa_calor' | 'sobre'>('visao_geral');
  const [filtroCalor, setFiltroCalor] = useState<string>('Todas');

  // 👇 ESTADOS PARA CONTROLAR A RESPONSIVIDADE E O MENU MOBILE
  const [isMobile, setIsMobile] = useState(window.innerWidth <= 768);
  const [menuAberto, setMenuAberto] = useState(false);

  // Monitora o tamanho da tela em tempo real
  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth <= 768);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
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
          lista.push({
            id: doc.id,
            latitude: dados.coordenada.latitude,
            longitude: dados.coordenada.longitude,
            categoria: dados.categoria || 'Sem categoria',
            titulo: dados.titulo || 'Sem título',
            hora: dados.hora || '--:--', 
            criadoEm: dados.criadoEm || 0, 
          });
        }
      });
      setAlertas(lista);
    });
    return () => unsubscribe();
  }, []);

  const exportarDados = () => {
    if (alertas.length === 0) return;
    const cabecalho = ["ID", "Data", "Hora", "Categoria", "Descricao", "Latitude", "Longitude"];
    const linhas = alertas.map(alerta => {
      const data = new Date(alerta.criadoEm || 0).toLocaleDateString('pt-BR');
      return [
        alerta.id, data, alerta.hora, alerta.categoria,
        `"${alerta.titulo.replace(/"/g, '""')}"`, 
        alerta.latitude.toString().replace('.', ','), 
        alerta.longitude.toString().replace('.', ',')   
      ].join(";"); 
    });
    const csvContent = "\uFEFF" + [cabecalho.join(";"), ...linhas].join("\n"); 
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.setAttribute("href", url);
    link.setAttribute("download", `relatorio_meu_alerta_${new Date().getTime()}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const alertasPorCategoria = alertas.reduce((acc: any, alerta) => {
    acc[alerta.categoria] = (acc[alerta.categoria] || 0) + 1;
    return acc;
  }, {});

  const dadosGrafico = Object.keys(alertasPorCategoria).map((chave) => ({
    nome: chave, quantidade: alertasPorCategoria[chave],
  }));

  const alertasPorDia = alertas.reduce((acc: any, alerta) => {
    if (alerta.criadoEm) {
      const dataFormatada = new Date(alerta.criadoEm).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
      acc[dataFormatada] = (acc[dataFormatada] || 0) + 1;
    }
    return acc;
  }, {});

  const dadosLinhaTempo = Object.keys(alertasPorDia).map((data) => ({
    data: data, ocorrencias: alertasPorDia[data],
  })).sort((a, b) => {
    const [diaA, mesA] = a.data.split('/');
    const [diaB, mesB] = b.data.split('/');
    return new Date(2024, Number(mesA)-1, Number(diaA)).getTime() - new Date(2024, Number(mesB)-1, Number(diaB)).getTime();
  });

  const alertasRecentes = [...alertas].sort((a, b) => (b.criadoEm || 0) - (a.criadoEm || 0));
  const categoriasUnicas = Array.from(new Set(alertas.map(a => a.categoria)));

  const alertasParaOMapa = filtroCalor === 'Todas' ? alertas : alertas.filter(a => a.categoria === filtroCalor);
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

  if (!minhaLocalizacao) {
    return <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '100vh', backgroundColor: '#F2F2F7' }}>
      <h2 style={{ color: '#1C1C1E' }}>A carregar o Centro de Comando... 🌍</h2>
    </div>;
  }

  return (
    <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', width: '100vw', height: '100vh', backgroundColor: '#F2F2F7', overflow: 'hidden' }}>
      
      {/* 👇 CABEÇALHO PARA MOBILE (Só aparece no telemóvel) 👇 */}
      {isMobile && (
        <div style={{ padding: '16px 20px', backgroundColor: 'white', display: 'flex', alignItems: 'center', justifyContent: 'space-between', zIndex: 10, boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
          <h2 style={{ margin: 0, fontSize: '18px', display: 'flex', alignItems: 'center', gap: '8px', color: '#1C1C1E' }}>
            <FaCircleNodes color="#007AFF" /> Meu Alerta <span style={{ fontSize: '11px', color: '#8E8E93' }}>DASH</span>
          </h2>
          <button onClick={() => setMenuAberto(true)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
            <MdMenu size={28} color="#1C1C1E" />
          </button>
        </div>
      )}

      {/* MENU LATERAL */}
      <div style={{ 
        width: '260px', backgroundColor: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(20px)', padding: '30px 20px', borderRight: '1px solid rgba(0,0,0,0.05)', display: 'flex', flexDirection: 'column',
        position: isMobile ? 'fixed' : 'relative',
        top: 0, bottom: 0, zIndex: 9999,
        left: isMobile ? (menuAberto ? '0' : '-100%') : '0',
        transition: 'left 0.3s ease',
        boxShadow: isMobile && menuAberto ? '10px 0 30px rgba(0,0,0,0.2)' : 'none'
      }}>
        
        {isMobile && (
          <button onClick={() => setMenuAberto(false)} style={{ position: 'absolute', top: 20, right: 20, background: 'none', border: 'none', cursor: 'pointer' }}>
            <MdClose size={24} color="#8E8E93" />
          </button>
        )}

        <h2 style={{ color: '#1C1C1E', fontSize: '22px', fontWeight: '800', paddingBottom: '20px', marginTop: isMobile ? '20px' : 0, display: 'flex', alignItems: 'center', gap: '10px', letterSpacing: '-0.5px' }}>
          <FaCircleNodes style={{ fontSize: '26px', color: '#007AFF' }} /> 
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px' }}>
            Meu Alerta 
            <span style={{ fontSize: '13px', fontWeight: '600', color: '#8E8E93', textTransform: 'uppercase' }}>Dash</span>
          </div>
        </h2>
        
        <ul style={{ listStyle: 'none', padding: 0, marginTop: '10px', color: '#8E8E93', fontWeight: '500', flex: 1 }}>
          <li onClick={() => { setAbaAtiva('visao_geral'); setMenuAberto(false); }} style={{ padding: '12px 16px', backgroundColor: abaAtiva === 'visao_geral' ? '#007AFF' : 'transparent', color: abaAtiva === 'visao_geral' ? 'white' : '#8E8E93', borderRadius: '12px', marginBottom: '8px', cursor: 'pointer', fontWeight: '600', boxShadow: abaAtiva === 'visao_geral' ? '0 4px 12px rgba(0, 122, 255, 0.3)' : 'none', transition: '0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <MdSpaceDashboard size={20} /> Visão Geral
          </li>
          
          <li onClick={() => { setAbaAtiva('mapa_calor'); setMenuAberto(false); }} style={{ padding: '12px 16px', backgroundColor: abaAtiva === 'mapa_calor' ? '#007AFF' : 'transparent', color: abaAtiva === 'mapa_calor' ? 'white' : '#8E8E93', borderRadius: '12px', marginBottom: '8px', cursor: 'pointer', fontWeight: '600', boxShadow: abaAtiva === 'mapa_calor' ? '0 4px 12px rgba(0, 122, 255, 0.3)' : 'none', transition: '0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <AiOutlineHeatMap size={20} /> Mapa de Calor
          </li>

          <li onClick={() => { setAbaAtiva('sobre'); setMenuAberto(false); }} style={{ padding: '12px 16px', backgroundColor: abaAtiva === 'sobre' ? '#007AFF' : 'transparent', color: abaAtiva === 'sobre' ? 'white' : '#8E8E93', borderRadius: '12px', marginBottom: '8px', cursor: 'pointer', fontWeight: '600', boxShadow: abaAtiva === 'sobre' ? '0 4px 12px rgba(0, 122, 255, 0.3)' : 'none', transition: '0.2s', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <FaInfoCircle size={18} /> Sobre o Projeto
          </li>
        </ul>

        <div onClick={exportarDados} style={{ padding: '12px 16px', cursor: 'pointer', transition: '0.2s', display: 'flex', alignItems: 'center', gap: '10px', color: '#1C1C1E', fontWeight: '600', backgroundColor: '#E5E5EA', borderRadius: '12px', justifyContent: 'center' }}>
          <FaDownload size={16} /> Exportar CSV
        </div>
      </div>

      {/* ÁREA PRINCIPAL DINÂMICA */}
      <div style={{ flex: 1, padding: isMobile ? '20px' : '30px 40px', display: 'flex', flexDirection: 'column', gap: '24px', overflowY: 'auto' }}>
        
        {abaAtiva === 'visao_geral' && (
          /* =================== VISÃO GERAL =================== */
          <>
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)', gap: '24px' }}>
              <div style={cardStyle}><span style={{ color: '#8E8E93', fontSize: '13px', fontWeight: '600' }}>Total de Registros</span><span style={{ color: '#1C1C1E', fontSize: '40px', fontWeight: '700' }}>{alertas.length}</span></div>
              <div style={cardStyle}><span style={{ color: '#8E8E93', fontSize: '13px', fontWeight: '600' }}>Categoria Frequente</span><span style={{ color: '#1C1C1E', fontSize: '24px', fontWeight: '700', marginTop: '16px' }}>{dadosGrafico.length > 0 ? dadosGrafico.sort((a,b) => b.quantidade - a.quantidade)[0].nome : '---'}</span></div>
              <div style={cardStyle}><span style={{ color: '#8E8E93', fontSize: '13px', fontWeight: '600' }}>Status da Conexão</span><span style={{ color: '#34C759', fontSize: '24px', fontWeight: '700', marginTop: '16px' }}>Tempo Real Ativo</span></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr 1fr', gap: '24px', minHeight: isMobile ? 'auto' : '340px' }}>
              <div style={{ ...cardStyle, minHeight: '300px' }}>
                <h3 style={{ color: '#1C1C1E', fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>Evolução Diária</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={dadosLinhaTempo}>
                    <defs><linearGradient id="corOnda" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#007AFF" stopOpacity={0.2}/><stop offset="95%" stopColor="#007AFF" stopOpacity={0}/></linearGradient></defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5EA" />
                    <XAxis dataKey="data" stroke="#8E8E93" fontSize={11} axisLine={false} tickLine={false}/><YAxis stroke="#8E8E93" fontSize={11} width={30} axisLine={false} tickLine={false}/>
                    <Tooltip contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 8px 24px rgba(0,0,0,0.12)' }} />
                    <Area type="monotone" dataKey="ocorrencias" stroke="#007AFF" strokeWidth={4} fill="url(#corOnda)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <div style={{ ...cardStyle, minHeight: '300px' }}>
                <h3 style={{ color: '#1C1C1E', fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>Ocorrências por Tipo</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={dadosGrafico}><CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E5EA" /><XAxis dataKey="nome" stroke="#8E8E93" fontSize={11} axisLine={false} tickLine={false}/><YAxis stroke="#8E8E93" fontSize={11} width={30} axisLine={false} tickLine={false}/><Tooltip cursor={{fill: '#F2F2F7'}} contentStyle={{ borderRadius: '16px', border: 'none' }}/>
                    <Bar dataKey="quantidade" radius={[6, 6, 0, 0]} maxBarSize={32}>{dadosGrafico.map((_, index) => <Cell key={`cell-bar-${index}`} fill={CORES[index % CORES.length]} />)}</Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div style={{ ...cardStyle, minHeight: '300px' }}>
                <h3 style={{ color: '#1C1C1E', fontSize: '18px', fontWeight: '700', marginBottom: '20px' }}>Distribuição</h3>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart><Pie data={dadosGrafico} dataKey="quantidade" cx="50%" cy="50%" innerRadius={55} outerRadius={80} paddingAngle={4} stroke="none">{dadosGrafico.map((_, index) => <Cell key={`cell-pie-${index}`} fill={CORES[index % CORES.length]} />)}</Pie><Tooltip contentStyle={{ borderRadius: '16px', border: 'none' }}/></PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '7fr 3fr', gap: '24px', flex: 1, minHeight: isMobile ? 'auto' : '380px' }}>
              <div style={{ ...cardStyle, padding: 0, overflow: 'hidden', minHeight: isMobile ? '400px' : 'auto' }}>
                <MapContainer center={minhaLocalizacao} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}><TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                  {alertas.map((alerta) => { const cor = getCorCategoria(alerta.categoria);
                  return <Marker key={alerta.id} position={[alerta.latitude, alerta.longitude]} icon={criarIconeVazado(cor)}><Popup><strong style={{ color: cor }}>{alerta.categoria}</strong><br />{alerta.titulo}</Popup></Marker>;
                  })}
                </MapContainer>
              </div>

              <div style={{ ...cardStyle, overflowY: 'auto', maxHeight: isMobile ? '400px' : 'none' }}>
                <h3 style={{ color: '#1C1C1E', fontSize: '18px', fontWeight: '700', display: 'flex', justifyContent: 'space-between' }}><span>Feed ao Vivo</span><span style={{ fontSize: '11px', backgroundColor: '#F2F2F7', padding: '4px 10px', borderRadius: '20px', color: '#8E8E93' }}>AGORA</span></h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px', marginTop: '16px' }}>
                  {alertasRecentes.slice(0, 15).map((alerta) => { const cor = getCorCategoria(alerta.categoria); return <div key={alerta.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px' }}><div style={{ width: '10px', height: '10px', borderRadius: '50%', backgroundColor: cor, marginTop: '6px', boxShadow: `0 0 8px ${cor}66` }}></div><div style={{ flex: 1 }}><div style={{ display: 'flex', justifyContent: 'space-between' }}><strong style={{ color: '#1C1C1E', fontSize: '14px' }}>{alerta.categoria}</strong><span style={{ color: '#8E8E93', fontSize: '12px' }}>{alerta.hora}</span></div><span style={{ color: '#8E8E93', fontSize: '13px' }}>{alerta.titulo}</span></div></div>;
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {abaAtiva === 'mapa_calor' && (
          /* =================== MAPA DE CALOR COM FILTROS =================== */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
            <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', justifyContent: 'space-between', alignItems: isMobile ? 'flex-start' : 'center', gap: isMobile ? '10px' : '0', marginBottom: '24px' }}>
              <h1 style={{ color: '#1C1C1E', fontSize: isMobile ? '24px' : '28px', fontWeight: '700', margin: 0 }}>Mapa de Calor</h1>
              <span style={{ color: '#8E8E93', fontSize: '14px', fontWeight: '600' }}>Mostrando {alertasParaOMapa.length} ocorrências</span>
            </div>
            
            <div style={{ ...cardStyle, flex: 1, padding: 0, overflow: 'hidden', position: 'relative', minHeight: isMobile ? '500px' : 'auto' }}>
              <div style={{ position: 'absolute', top: isMobile ? 10 : 20, left: isMobile ? 10 : 60, zIndex: 1000, display: 'flex', gap: '8px', flexWrap: 'wrap', maxWidth: isMobile ? '90%' : '60%' }}>
                <button onClick={() => setFiltroCalor('Todas')} style={{ padding: '8px 16px', border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', backgroundColor: filtroCalor === 'Todas' ? '#1C1C1E' : 'rgba(255,255,255,0.9)', color: filtroCalor === 'Todas' ? 'white' : '#8E8E93', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>Todas</button>
                {categoriasUnicas.map(categoria => <button key={categoria} onClick={() => setFiltroCalor(categoria as string)} style={{ padding: '8px 16px', border: 'none', borderRadius: '20px', fontSize: '13px', fontWeight: '600', cursor: 'pointer', backgroundColor: filtroCalor === categoria ? '#007AFF' : 'rgba(255,255,255,0.9)', color: filtroCalor === categoria ? 'white' : '#8E8E93', boxShadow: '0 4px 12px rgba(0,0,0,0.1)' }}>{categoria as string}</button>)}
              </div>
        
              <div style={{ position: 'absolute', bottom: isMobile ? 20 : 'auto', top: isMobile ? 'auto' : 20, right: isMobile ? '50%' : 20, transform: isMobile ? 'translateX(50%)' : 'none', zIndex: 1000, backgroundColor: 'rgba(255,255,255,0.95)', backdropFilter: 'blur(10px)', padding: '16px', borderRadius: '16px', boxShadow: '0 4px 16px rgba(0,0,0,0.12)' }}>
                <strong style={{ display: 'block', marginBottom: '12px', fontSize: '14px', textAlign: 'center' }}>Níveis de Ocorrência</strong>
                <div style={{ width: '200px', height: '14px', borderRadius: '8px', background: cssLegenda }}></div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '6px', fontSize: '11px', color: '#8E8E93', fontWeight: '600' }}><span>Nível 1 (Leve)</span><span>Nível 5 (Crítico)</span></div>
              </div>

              <MapContainer center={minhaLocalizacao} zoom={14} style={{ height: '100%', width: '100%', zIndex: 1 }}>
                <TileLayer url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png" />
                <CamadaCalor alertas={alertasParaOMapa} gradiente={gradienteAtual} />
              </MapContainer>
            </div>
          </div>
        )}

        {abaAtiva === 'sobre' && (
          /* =================== ABA SOBRE =================== */
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '24px' }}>
            <h1 style={{ color: '#1C1C1E', margin: 0, fontSize: isMobile ? '24px' : '28px', fontWeight: '700' }}>Sobre o Projeto</h1>
            
            <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '3fr 1fr', gap: '24px', flex: 1 }}>
              
              <div style={{ ...cardStyle, justifyContent: 'flex-start', gap: '20px' }}>
                <div>
                  <h2 style={{ color: '#007AFF', fontSize: '20px', marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    O que é o <FaCircleNodes />Meu Alerta DASH?
                  </h2>
                  <p style={{ color: '#1C1C1E', lineHeight: '1.6', fontSize: '15px' }}>
                    É este painel de controle que você está acessando. Ele recebe todos os chamados do aplicativo <strong>Meu Alerta</strong> e funciona como uma linha direta entre a população — desde o centro até ao interior da cidade — e as equipes gestoras que cuidam da nossa segurança e infraestrutura.
                  </p>
                </div>

                <div>
                  <h2 style={{ color: '#007AFF', fontSize: '20px', marginBottom: '8px' }}>Como funciona?</h2>
                  <p style={{ color: '#1C1C1E', lineHeight: '1.6', fontSize: '15px' }}>
                    Quando um morador usa o aplicativo para avisar sobre uma ocorrência — como o nível perigoso de uma passagem molhada, alagamentos, falta de luz ou vias interditadas —, esse alerta aparece aqui no nosso mapa na mesma hora. O painel agrupa esses avisos e mostra visualmente onde a situação é mais crítica, ajudando os gestores a saberem exatamente para onde devem enviar ajuda primeiro.
                  </p>
                </div>

                <div style={{ backgroundColor: '#F2F2F7', padding: '16px', borderRadius: '12px', marginTop: '10px' }}>
                  <strong style={{ color: '#1C1C1E', display: 'block', marginBottom: '4px' }}>Missão</strong>
                  <span style={{ color: '#8E8E93', fontSize: '14px' }}>Agilizar o atendimento à população, ouvindo a voz de cada comunidade e usando a tecnologia para prevenir desastres, salvar vidas e evitar acidentes.</span>
                </div>
              </div>

              <div style={{ ...cardStyle, justifyContent: 'flex-start', gap: '25px' }}>
                <h2 style={{ color: '#007AFF', fontSize: '16px', marginBottom: '0px' }}>Tecnologias Utilizadas</h2>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{fontSize: '11px', color: '#1C1C1E' }}>Linguagem & Interface</strong>
                    <span style={{ fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>React com TypeScript</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{ fontSize: '11px', color: '#1C1C1E' }}>Banco de Dados</strong>
                    <span style={{ fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>Firebase Cloud Firestore</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{fontSize: '11px', color: '#1C1C1E' }}>Geolocalização & Mapas</strong>
                    <span style={{ fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>Leaflet & React-Leaflet</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{ fontSize: '11px', color: '#1C1C1E' }}>Mapas</strong>
                    <span style={{fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>OpenStreetMap & CartoDB</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{ fontSize: '11px', color: '#1C1C1E' }}>Inteligência Térmica</strong>
                    <span style={{ fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>Leaflet.heat</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{ fontSize: '11px', color: '#1C1C1E' }}>Gráficos Analíticos</strong>
                    <span style={{fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>Recharts</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #E5E5EA', paddingBottom: '8px' }}>
                    <strong style={{ fontSize: '11px', color: '#1C1C1E' }}>Iconografia & Design</strong>
                    <span style={{fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>React Icons & Inter Font</span>
                  </li>
                  <li style={{ display: 'flex', justifyContent: 'space-between', paddingBottom: '8px' }}>
                    <strong style={{ fontSize: '11px', color: '#1C1C1E' }}>Processamento de Dados</strong>
                    <span style={{ fontSize: '11px', color: '#8E8E93', textAlign: 'right' }}>Exportação nativa CSV (Blob API)</span>
                  </li>
                </ul>
              </div>

            </div>
          </div>
        )}

      </div>
    </div>
  );
}

export default App;