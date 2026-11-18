/**
 * Modelo comum dos registros territoriais lidos do Firestore.
 * O histórico analisa a DATA DE CRIAÇÃO, não reconstrói o estado de
 * atividade de dias anteriores (não há histórico dos votos/fechamentos).
 */
export type AlertaTerritorial = {
  id: string;
  latitude: number;
  longitude: number;
  categoria: string;
  titulo: string;
  detalhe?: string;
  hora?: string;
  criadoEm?: number;
  expiraEm?: number;
  ultimaConfirmacaoEm?: number;
  condicoesQuentura?: string[];
  sombraQuentura?: string | null;
  milimetrosChuva?: number;
  votosConfirma?: number;
  votosResolvido?: number;
  /** Horário em que a comunidade confirmou o restabelecimento. */
  restabelecidoEm?: number;
  restabelecimentoFonte?: string;
  autor?: string;
  temFoto?: boolean;
  fotoUrl?: string;
};

const HORA = 60 * 60 * 1000;
const DIA = 24 * HORA;

export function dataEmMillis(valor: unknown): number | undefined {
  const v = valor as { toMillis?: () => number } | null;
  const numerico = typeof v?.toMillis === 'function'
    ? v.toMillis()
    : typeof valor === 'number' ? valor : NaN;
  return Number.isFinite(numerico) && numerico > 0
    ? numerico : undefined;
}

/** Replica as durações definidas pelo aplicativo. */
export function validadeCategoria(categoria: string, detalhe?: string): number {
  if (categoria === 'Chuvas' || categoria === 'Quentura') return 12 * HORA;
  if (categoria === 'Energia') return DIA;
  if (categoria === 'Passagem') return 5 * DIA;
  if (categoria === 'Estrada') {
    if (detalhe === 'Lama (interditado)') return 5 * DIA;
    if (detalhe === 'Obstáculo') return 2 * DIA;
    if (detalhe === 'Buraco' || detalhe === 'Buraco — dá para passar') return 21 * DIA;
    if (detalhe === 'Buraco — não dá para passar') return 7 * DIA;
  }
  return DIA;
}

/** Os registros legados sem expiraEm só usam um prazo derivado se há data conhecida. */
export function prazoDoAlerta(alerta: AlertaTerritorial): number | null {
  if (typeof alerta.expiraEm === 'number' &&
      Number.isFinite(alerta.expiraEm) && alerta.expiraEm > 0) {
    return alerta.expiraEm;
  }
  const referencia = alerta.ultimaConfirmacaoEm ?? alerta.criadoEm;
  if (typeof referencia !== 'number' || !Number.isFinite(referencia) || referencia <= 0) {
    return null;
  }
  return referencia + validadeCategoria(alerta.categoria, alerta.detalhe);
}

export function statusDoAlerta(
  alerta: AlertaTerritorial,
  agora: number
): 'ativo' | 'resolvido' | 'expirado' | 'sem-data' {
  if (alerta.categoria === 'Energia' && typeof alerta.restabelecidoEm === 'number' &&
      Number.isFinite(alerta.restabelecidoEm) && alerta.restabelecidoEm > 0) return 'resolvido';
  if ((alerta.votosResolvido ?? 0) >= 3) return 'resolvido';
  const validade = prazoDoAlerta(alerta);
  if (validade === null) return 'sem-data';
  return validade > agora ? 'ativo' : 'expirado';
}

export function alertaAtivo(alerta: AlertaTerritorial, agora: number): boolean {
  return statusDoAlerta(alerta, agora) === 'ativo';
}

/** Subcategorias reais. Quentura aceita múltiplas condições por registro. */
export function subcategoriasDoAlerta(alerta: AlertaTerritorial): string[] {
  if (alerta.categoria !== 'Quentura') {
    const detalhe = alerta.detalhe?.trim() ||
      (alerta.titulo?.includes(':') ? alerta.titulo.split(':').slice(1).join(':').trim().replace(/\s*\([\d.,]+mm\)\s*$/i, '') : '');
    return [detalhe || 'Não informado'];
  }
  const estruturadas = (alerta.condicoesQuentura ?? [])
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.trim());
  if (estruturadas.length > 0) return [...new Set(estruturadas)];
  const detalhadas = (alerta.detalhe ?? '')
    .split(/\s*\+\s*/)
    .map(v => v.trim())
    .filter(v => v.length > 0 && !/^Sombra\s*:/i.test(v));
  return detalhadas.length > 0
    ? [...new Set(detalhadas)]
    : ['Sem condição informada'];
}

export type Sombra = 'Sim' | 'Não' | 'Parcialmente' | 'Não informado';

export function sombraDoAlerta(alerta: AlertaTerritorial): Sombra {
  if (alerta.categoria !== 'Quentura') return 'Não informado';
  const texto = typeof alerta.sombraQuentura === 'string'
    ? alerta.sombraQuentura
    : alerta.detalhe?.match(/Sombra\s*:\s*(Parcialmente|Parcial|Sim|N[aã]o)/i)?.[1];
  const normalizada = (texto ?? '').trim().toLowerCase();
  if (normalizada === 'sim') return 'Sim';
  if (normalizada === 'não' || normalizada === 'nao') return 'Não';
  if (normalizada === 'parcial' || normalizada === 'parcialmente') return 'Parcialmente';
  return 'Não informado';
}

/** Duração entre o primeiro relato e a confirmação do retorno, não a duração oficial. */
export function duracaoObservadaEnergiaMs(alerta: AlertaTerritorial): number | null {
  if (alerta.categoria !== 'Energia' || !Number.isFinite(alerta.criadoEm) ||
      !Number.isFinite(alerta.restabelecidoEm)) return null;
  const duracao = alerta.restabelecidoEm! - alerta.criadoEm!;
  return duracao >= 0 ? duracao : null;
}

export const CORES_OCORRENCIAS: Record<string, string> = {
  Chuvas: '#168FC4',
  Passagem: '#D59A35',
  Energia: '#8868B8',
  Estrada: '#3A9B78',
  Quentura: '#D65B39'
};
