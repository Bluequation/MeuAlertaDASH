/**
 * CUIDAÍ | ÁGUA — ETAPA 3
 * Área de água PROVISÓRIA — imagem única de 31/03/2026.
 *
 * PRÉ-REQUISITO: "geometry" importada no topo do script, como Polygon.
 * Copie este código para uma CÓPIA do script 02, preservando Imports.
 *
 * Cuidado científico:
 * - Usa NDWI > 0 como classificação INICIAL, não validada.
 * - Exclui pixels com nuvem/sombra, mas ainda pode ter falsos positivos.
 * - Mede apenas a água observável DENTRO do polígono.
 * - Se a cobertura válida for baixa, a área fica subestimada.
 * - NÃO mede volume, profundidade ou área máxima histórica.
 */

var aoi = geometry;
var ponto = ee.Geometry.Point([-40.7703, -4.8986]);
var regiaoBusca = ponto.buffer(3500);
var LIMIAR_NDWI = 0.0;

Map.setOptions('SATELLITE');
Map.centerObject(aoi, 14);

// Localiza a MESMA seleção da etapa 2, conservando a data e
// o critério de qualidade junto ao açude.
function pontuarCena(imagem) {
  var scl = imagem.select('SCL');
  var valido = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10));

  var proporcao = ee.Number(
    valido.unmask(0, false).rename('valido').reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: regiaoBusca,
      scale: 60,
      maxPixels: 100000,
      bestEffort: true,
      tileScale: 2
    }).get('valido', 0)
  );
  return imagem.set('proporcao_valida_local', proporcao);
}

var candidatas = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(regiaoBusca)
  .filterDate('2026-03-20', '2026-05-15')
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 95))
  .map(pontuarCena)
  .sort('proporcao_valida_local', false);

var cena = ee.Image(candidatas.first());

print('Data da imagem escolhida (deve ser 31/03/2026):',
  ee.Date(cena.get('system:time_start')).format('dd/MM/yyyy'));
print('Identificador da cena (para rastreabilidade):',
  cena.get('system:index'));

// Máscara de qualidade espacial. A classe SCL 11 representa gelo/neve.
var scl = cena.select('SCL');
var pixelsValidos = scl.neq(0)
  .and(scl.neq(1))
  .and(scl.neq(3))
  .and(scl.neq(8))
  .and(scl.neq(9))
  .and(scl.neq(10))
  .and(scl.neq(11));

// NDWI: (verde - infravermelho próximo) / (verde + infravermelho próximo).
// A classificação limiar > 0 é apenas um ponto de partida.
var ndwi = cena.normalizedDifference(['B3', 'B8'])
  .rename('NDWI')
  .updateMask(pixelsValidos)
  .clip(aoi);

var agua = ndwi.gt(LIMIAR_NDWI).selfMask().rename('agua');

// Área da água, cobertura observável e área total do polígono, em hectares.
var areaHa = ee.Image.pixelArea().divide(10000).rename('area_ha');

function somarHectares(imagem) {
  var resultado = imagem.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: aoi,
    scale: 10,
    maxPixels: 1e9,
    tileScale: 4
  });
  return ee.Number(ee.Algorithms.If(
    resultado.get('area_ha'), resultado.get('area_ha'), 0
  ));
}

var aguaHa = somarHectares(areaHa.updateMask(agua));
var validosHa = somarHectares(areaHa.updateMask(ndwi.mask()));
var poligonoHa = somarHectares(areaHa);
var coberturaPct = validosHa.divide(poligonoHa).multiply(100);

print('ÁREA PROVISÓRIA CLASSIFICADA COMO ÁGUA (ha):',
  aguaHa.format('%.2f'));
print('Área total do polígono de estudo (ha):',
  poligonoHa.format('%.2f'));
print('Cobertura válida dentro do polígono (%):',
  coberturaPct.format('%.1f'));
print('AVISO: resultado preliminar; NÃO representa volume nem área oficial.');

// Fundo Google Satélite preservado. RGB Sentinel-2 opcional.
Map.addLayer(
  cena,
  {bands: ['B4', 'B3', 'B2'], min: 0, max: 3500, gamma: 1.15},
  'Cena Sentinel-2 2026 (opcional)', false
);

// O azul revela SOMENTE pixels classificados como água.
Map.addLayer(
  agua,
  {palette: ['17A9E3']},
  'Água provável — NDWI > 0 (azul)', true, 0.75
);

// Contorno fino: NÃO colore a área interna.
var contorno = ee.Image().byte().paint(
  ee.FeatureCollection([ee.Feature(aoi)]), 1, 2
);
Map.addLayer(
  contorno.selfMask(),
  {palette: ['FF9B3E']},
  'Contorno do polígono (laranja)', true
);

print('Se aparecer uma mancha laranja preenchida, esconda a geometria');
print('em Geometry Imports; o script continua usando geometry normalmente.');
print('Antes de usar o número, verifique se o azul acompanha a água real');
print('e se a cobertura válida está próxima de 100%.');
