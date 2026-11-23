export const RESERVATORIO_PILOTO = {
  id: 'sao-jose-iii',
  nome: 'Açude São José III',
  municipio: 'Ipaporanga',
  sistema: 'Sertões de Crateús',
  riacho: 'Riacho São José',
  areaBaciaKm2: 99.35,
  capacidadeHm3: 9.12,
  cotaSangradouroM: 100,
  larguraSangradouroM: 37.9,
  latitude: -4.8986,
  longitude: -40.7703,
  fonteFicha: 'https://www.cogerh.com.br/FichaTecnicadosAcudes/fichaTecnicaAcude.php?acude=S%C3%A3o+Jos%C3%A9+III',
  fonteCoordenadas: 'https://portal.cogerh.com.br/wp-content/uploads/2021/07/INICIANDO-O-DI%C3%81LOGO-RHSC.pdf'
} as const;

export type CenaSuperficie = {
  id: string;
  data: string;
  areaHa: number;
  satelite: 'Sentinel-2' | 'Landsat';
  nuvensPct: number | null;
  coberturaValidaPct: number | null;
  limiarNdwi: number | null;
  resolucaoM: number | null;
  cenaId: string | null;
  previewUrl: string | null;
};

export type LeituraHidrometeorologica = {
  reservatorioId: string;
  estacaoId: string;
  observadoEm: number;
  temperaturaArC?: number;
  umidadeRelativaPct?: number;
  velocidadeVentoMs?: number;
  direcaoVentoGraus?: number;
  radiacaoSolarWm2?: number;
  precipitacaoMm?: number;
  pressaoHpa?: number;
  nivelAguaM?: number;
  temperaturaAguaC?: number;
  bateriaV?: number;
  qualidade: 'valida' | 'suspeita' | 'invalida';
  origem: 'sensor';
};

export const COLECOES_FIRESTORE_AGUA = {
  reservatorios: 'reservatorios',
  leituras: 'leiturasHidrometeorologicas',
  cenas: 'analisesSuperficie',
  evaporacao: 'estimativasEvaporacao'
} as const;

function normalizarCabecalho(valor: string): string {
  return valor
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function separarLinhaCSV(linha: string, delimitador: string): string[] {
  const valores: string[] = [];
  let atual = '';
  let aspas = false;

  for (let i = 0; i < linha.length; i++) {
    const caractere = linha[i];

    if (caractere === '"') {
      if (aspas && linha[i + 1] === '"') {
        atual += '"';
        i++;
      } else {
        aspas = !aspas;
      }
    } else if (caractere === delimitador && !aspas) {
      valores.push(atual.trim());
      atual = '';
    } else {
      atual += caractere;
    }
  }

  valores.push(atual.trim());
  return valores;
}

function numeroCSV(valor: string | undefined): number | null {
  if (!valor) return null;
  let limpo = valor.trim().replace(/\s/g, '');
  if (!limpo) return null;

  if (limpo.includes(',')) {
    limpo = limpo.replace(/\./g, '').replace(',', '.');
  }

  const numero = Number(limpo);
  return Number.isFinite(numero) ? numero : null;
}

function dataISO(valor: string | undefined): string | null {
  if (!valor) return null;
  const texto = valor.trim();

  const brasileira = texto.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (brasileira) {
    return brasileira[3] + '-' + brasileira[2] + '-' + brasileira[1];
  }

  const data = new Date(texto);
  if (!Number.isFinite(data.getTime())) return null;
  return data.toISOString().slice(0, 10);
}

function obterCampo(
  linha: string[],
  indices: Map<string, number>,
  nomes: string[]
): string | undefined {
  for (const nome of nomes) {
    const indice = indices.get(nome);
    if (indice !== undefined) return linha[indice];
  }
  return undefined;
}

/**
 * Importa uma série processada no Google Earth Engine.
 * Cabeçalhos aceitos: date/data, area_ha, satellite/satelite,
 * cloud_pct/nuvens_pct, scene_id/id_cena e preview_url/imagem_url.
 */
export function importarSerieSuperficie(conteudo: string): CenaSuperficie[] {
  const linhas = conteudo
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .map(linha => linha.trim())
    .filter(Boolean);

  if (linhas.length < 2) {
    throw new Error('O CSV precisa conter um cabeçalho e pelo menos uma cena.');
  }

  const primeira = linhas[0];
  const delimitador = (primeira.match(/;/g) || []).length >
    (primeira.match(/,/g) || []).length ? ';' : ',';

  const cabecalhos = separarLinhaCSV(primeira, delimitador)
    .map(normalizarCabecalho);
  const indices = new Map<string, number>(cabecalhos.map((nome, indice) => [nome, indice] as const));

  const cenas: CenaSuperficie[] = [];

  linhas.slice(1).forEach((linha, indiceLinha) => {
    const colunas = separarLinhaCSV(linha, delimitador);
    const data = dataISO(obterCampo(colunas, indices, [
      'data', 'date', 'acquisition_date', 'data_aquisicao'
    ]));
    const areaHa = numeroCSV(obterCampo(colunas, indices, [
      'area_ha', 'area_ha_inundada', 'area_superficial_ha'
    ]));

    if (!data || areaHa === null || areaHa <= 0) return;

    const sateliteBruto = (obterCampo(colunas, indices, [
      'satelite', 'satellite', 'sensor'
    ]) || 'Sentinel-2').toLowerCase();

    const satelite: CenaSuperficie['satelite'] =
      sateliteBruto.includes('landsat') ? 'Landsat' : 'Sentinel-2';

    const nuvensPct = numeroCSV(obterCampo(colunas, indices, [
      'cloud_pct', 'nuvens_pct', 'cloud_cover', 'nuvens'
    ]));

    const coberturaBruta = numeroCSV(obterCampo(colunas, indices, [
      'valid_coverage_pct', 'cobertura_valida_pct', 'coverage_pct'
    ]));
    const limiarNdwi = numeroCSV(obterCampo(colunas, indices, [
      'ndwi_threshold', 'limiar_ndwi'
    ]));
    const resolucaoM = numeroCSV(obterCampo(colunas, indices, [
      'scale_m', 'escala_m', 'resolucao_m'
    ]));

    const cenaId = obterCampo(colunas, indices, [
      'scene_id', 'id_cena', 'system_index'
    ]) || null;

    const previewBruto = obterCampo(colunas, indices, [
      'preview_url', 'image_url', 'imagem_url', 'thumbnail'
    ]);
    let previewUrl: string | null = null;

    if (previewBruto) {
      try {
        const url = new URL(previewBruto);
        if (url.protocol === 'https:' || url.protocol === 'http:') {
          previewUrl = url.toString();
        }
      } catch {
        previewUrl = null;
      }
    }

    cenas.push({
      id: cenaId || (data + '-' + satelite + '-' + indiceLinha),
      data,
      areaHa,
      satelite,
      nuvensPct: nuvensPct !== null && nuvensPct >= 0 && nuvensPct <= 100
        ? nuvensPct
        : null,
      coberturaValidaPct: coberturaBruta !== null && coberturaBruta >= 0 && coberturaBruta <= 100
        ? coberturaBruta
        : null,
      limiarNdwi,
      resolucaoM: resolucaoM !== null && resolucaoM > 0 ? resolucaoM : null,
      cenaId,
      previewUrl
    });
  });

  if (cenas.length === 0) {
    throw new Error(
      'Nenhuma linha válida. Confira se o CSV possui data e area_ha em cada registro.'
    );
  }

  return cenas.sort((a, b) => a.data.localeCompare(b.data));
}
