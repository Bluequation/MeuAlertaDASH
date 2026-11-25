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

// Visualização em cores naturais: uma única cena em cada camada.
// SEM median() e SEM máscaras que introduzam aparência de colcha de retalhos.
var visual = {
  bands: ['B4', 'B3', 'B2'],
  min: 0,
  max: 3500,
  gamma: 1.15
};

Map.addLayer(cena2026, visual,
  '2026 — imagem única após cheia', true, 0.9);

Map.addLayer(cena2023, visual,
  '2023 — imagem única após cheia', false, 0.9);

// Camada de referência desligada para não esconder a água.
Map.addLayer(pontoReferencia, {color: 'FF453A'},
  'Ponto de referência (opcional)', false);

print('Em Layers: ligue 2023 e desligue 2026 para comparar.');
print('A data real de cada cena está em Console.');
print('Use zoom moderado: cada pixel Sentinel-2 equivale a 10 metros.');
print('Só desenhe o polígono depois de inspecionar as duas datas.');
