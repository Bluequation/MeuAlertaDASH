/**
 * CUIDAÍ | ÁGUA — ETAPA 2
 * Comparar cenas reais do Sentinel-2 após períodos de sangria do São José III.
 *
 * IMPORTANTE:
 * - Cada camada é UMA imagem de UMA data, não um mosaico de meses.
 * - Seleção automática da cena com maior proporção de pixels sem nuvens
 *   ao redor do açude (incluindo cobertura espacial da imagem).
 * - Não é uma medição de área, nível ou volume.
 * - O RGB do Sentinel-2 tem 10 m/pixel: zoom extremo revela pixels.
 */

var pontoReferencia = ee.Geometry.Point([-40.7703, -4.8986]);
var regiaoConferencia = pontoReferencia.buffer(3000);

Map.setOptions('SATELLITE');
Map.centerObject(pontoReferencia, 13);

// Classificação SCL: excluir pixels sem dados, sombras e nuvens na
// AVALIAÇÃO da qualidade. A imagem RGB é exibida sem mascaramento.
function avaliarQualidadeLocal(imagem) {
  var scl = imagem.select('SCL');
  var limpo = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  // Valores zero também onde a cena não cobre a região de conferência.
  var fracaoLimpa = ee.Number(limpo.unmask(0, false).reduceRegion({
    reducer: ee.Reducer.mean(),
    geometry: regiaoConferencia,
    scale: 60,
    maxPixels: 100000,
    bestEffort: true,
    tileScale: 2
  }).get('SCL', 0));

  return imagem.set('fracao_limpa_local', fracaoLimpa);
}

function selecionarCena(inicio, fim, rotulo) {
  var candidatas = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(regiaoConferencia)
    .filterDate(inicio, fim)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 95))
    .map(avaliarQualidadeLocal)
    .sort('fracao_limpa_local', false);

  print(rotulo + ' — número de cenas avaliadas:', candidatas.size());

  var selecionada = ee.Image(candidatas.first());
  print(rotulo + ' — data exata da imagem:',
    ee.Date(selecionada.get('system:time_start')).format('dd/MM/YYYY'));
  print(rotulo + ' — pixels utilizáveis na região de verificação (%):',
    ee.Number(selecionada.get('fracao_limpa_local')).multiply(100).format('%.1f'));

  return selecionada;
}

// Janelas próximas a períodos de cheia documentados.
// São imagens posteriores aos eventos, e não necessariamente do dia da sangria.
var cena2026 = selecionarCena('2026-03-20', '2026-05-15', '2026');
var cena2023 = selecionarCena('2023-04-27', '2023-06-20', '2023');

// O fundo permanece sendo o Google Satélite, com alta nitidez.
// A classificação Sentinel-2 aparece apenas como MANCHA COLORIDA sobre o mapa.
// Assim não substituímos o fundo por pixels RGB de 10 m.
var limiteVisual = pontoReferencia.buffer(4500);

function aguaProvavel(imagem) {
  var scl = imagem.select('SCL');
  var pixelsValidos = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));

  var ndwi = imagem.normalizedDifference(['B3', 'B8']);
  return ndwi.gt(0)
    .updateMask(pixelsValidos)
    .selfMask()
    .clip(limiteVisual);
}

var agua2026 = aguaProvavel(cena2026);
var agua2023 = aguaProvavel(cena2023);

// Somente para investigação, RGB desligado por padrão.
// Se ativado, o RGB terá resolução menor que o fundo Google Satélite.
var visualRGB = {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 3500,
  gamma: 1.15
};
Map.addLayer(cena2026, visualRGB,
  'RGB Sentinel-2 2026 (opcional, 10 m)', false);
Map.addLayer(cena2023, visualRGB,
  'RGB Sentinel-2 2023 (opcional, 10 m)', false);

// As duas camadas azuis/laranjas podem ser ligadas ou desligadas
// independentemente em Layers; inicialmente só 2026 está visível.
Map.addLayer(agua2023, {palette: ['FF912D']},
  'ÁGUA PROVÁVEL 2023 — LARANJA', false, 0.68);
Map.addLayer(agua2026, {palette: ['008ED0']},
  'ÁGUA PROVÁVEL 2026 — AZUL', true, 0.68);

Map.addLayer(pontoReferencia, {color: 'FF453A'},
  'Ponto de referência (opcional)', false);

print('Compare em Layers: 2026 azul e 2023 laranja.');
print('O fundo é uma imagem Google Satélite; pode ser de outra data.');
print('A mancha colorida é uma ESTIMATIVA com pixels Sentinel-2 de 10 m.');
print('Não use o limite colorido como margem oficial sem validação.');
print('Desenhe a área de estudo após comparar ambas as datas.');
