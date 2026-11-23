/**
 * CUIDAÍ | ÁGUA — SÉRIE HISTÓRICA DA ÁREA SUPERFICIAL
 * Reservatório piloto: Açude São José III — Ipaporanga/CE
 *
 * COMO EXECUTAR
 * 1. Abra https://code.earthengine.google.com/
 * 2. Desenhe/importa manualmente um polígono AOI que cubra a extensão máxima
 *    conhecida do reservatório, sem incluir açudes vizinhos.
 * 3. O desenho precisa estar disponível com o nome "geometry".
 * 4. Revise os limiares NDWI de cada sensor após comparar cenas e referências de campo.
 * 5. Execute e exporte a tabela CSV para o Google Drive.
 *
 * IMPORTANTE
 * - O resultado é ÁREA SUPERFICIAL (ha), não volume armazenado.
 * - Os limiares NDWI são iniciais e precisam ser calibrados separadamente por sensor
 *   para turbidez, solo exposto e vegetação aquática do reservatório.
 * - A cobertura válida é calculada dentro do AOI e ajuda a identificar cenas incompletas.
 * - Cenas com nuvens/sombras e cobertura insuficiente devem ser revisadas.
 * - Não converta área em volume sem curva cota-área-volume validada.
 */

var aoi = geometry;
var DATA_INICIAL = '2013-03-18';
var DATA_FINAL = '2026-12-16'; // fim exclusivo
var LIMITE_NUVENS = 70;
var LIMIAR_NDWI_SENTINEL = 0.0; // inicial; calibrar com cenas e campo
var LIMIAR_NDWI_LANDSAT = 0.0;  // inicial; calibrar separadamente

Map.centerObject(aoi, 14);
Map.addLayer(aoi, {color: '00A6D6'}, 'Área de estudo — São José III');

function areaEmHectares(imagem, bandaVerde, bandaNIR, escala, sensor, nuvens, limiarNDWI) {
  var verde = imagem.select(bandaVerde);
  var nir = imagem.select(bandaNIR);
  var denominador = verde.add(nir);
  // expression evita a máscara automática de pixels negativos do normalizedDifference,
  // importante para reflectâncias Landsat já corrigidas pelo fator e offset do USGS.
  var ndwi = imagem.expression(
    '(green - nir) / (green + nir)',
    { green: verde, nir: nir }
  ).rename('NDWI').updateMask(denominador.neq(0));
  var mascaraAgua = ndwi.gt(limiarNDWI);

  var soma = ee.Image.pixelArea()
    .rename('area')
    .updateMask(mascaraAgua)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: escala,
      maxPixels: 1e10,
      tileScale: 4
    });

  var somaValida = ee.Image.pixelArea()
    .rename('area')
    .updateMask(ndwi.mask())
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: escala,
      maxPixels: 1e10,
      tileScale: 4
    });
  var somaAoi = ee.Image.pixelArea()
    .rename('area')
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: escala,
      maxPixels: 1e10,
      tileScale: 4
    });
  var areaValidaM2 = ee.Number(ee.Algorithms.If(somaValida.get('area'), somaValida.get('area'), 0));
  var areaTotalM2 = ee.Number(somaAoi.get('area'));
  var coberturaValidaPct = areaValidaM2.divide(areaTotalM2).multiply(100);
  var areaHa = ee.Algorithms.If(
    coberturaValidaPct.gt(0),
    ee.Number(ee.Algorithms.If(soma.get('area'), soma.get('area'), 0)).divide(10000),
    null
  );

  return ee.Feature(null, {
    data: ee.Date(imagem.get('system:time_start')).format('YYYY-MM-dd'),
    area_ha: areaHa,
    satellite: sensor,
    cloud_pct: nuvens,
    valid_coverage_pct: coberturaValidaPct,
    scene_id: imagem.get('system:index'),
    ndwi_threshold: limiarNDWI,
    escala_m: escala
  });
}

var sentinelOriginal = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi)
  .filterDate('2017-03-28', DATA_FINAL)
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', LIMITE_NUVENS));

var sentinelLista = sentinelOriginal.toList(sentinelOriginal.size());
var sentinelFeatures = ee.FeatureCollection(sentinelLista.map(function(item) {
  var imagem = ee.Image(item);
  var scl = imagem.select('SCL');
  var mascara = scl.neq(1)
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));
  var limpa = imagem.updateMask(mascara);

  return areaEmHectares(
    limpa,
    'B3',
    'B8',
    10,
    'Sentinel-2',
    imagem.get('CLOUDY_PIXEL_PERCENTAGE'),
    LIMIAR_NDWI_SENTINEL
  );
}));

function prepararLandsat(imagem, sensor, limiarNDWI) {
  var qa = imagem.select('QA_PIXEL');
  var mascaraNuvem = qa.bitwiseAnd(1 << 0).eq(0)
    .and(qa.bitwiseAnd(1 << 1).eq(0))
    .and(qa.bitwiseAnd(1 << 2).eq(0))
    .and(qa.bitwiseAnd(1 << 3).eq(0))
    .and(qa.bitwiseAnd(1 << 4).eq(0))
    .and(qa.bitwiseAnd(1 << 5).eq(0));

  var reflectancia = imagem
    .select(['SR_B3', 'SR_B5'])
    .multiply(0.0000275)
    .add(-0.2)
    .rename(['GREEN', 'NIR'])
    .updateMask(mascaraNuvem);

  return areaEmHectares(
    reflectancia,
    'GREEN',
    'NIR',
    30,
    sensor,
    imagem.get('CLOUD_COVER'),
    limiarNDWI
  );
}

function landsatParaFeatures(colecao, sensor, limiarNDWI) {
  var lista = colecao.toList(colecao.size());
  return ee.FeatureCollection(lista.map(function(item) {
    return prepararLandsat(ee.Image(item), sensor, limiarNDWI);
  }));
}

var colecaoLandsat8 = ee.ImageCollection('LANDSAT/LC08/C02/T1_L2')
  .filterBounds(aoi)
  .filterDate(DATA_INICIAL, DATA_FINAL)
  .filter(ee.Filter.lte('CLOUD_COVER', LIMITE_NUVENS));

var colecaoLandsat9 = ee.ImageCollection('LANDSAT/LC09/C02/T1_L2')
  .filterBounds(aoi)
  .filterDate('2021-10-31', DATA_FINAL)
  .filter(ee.Filter.lte('CLOUD_COVER', LIMITE_NUVENS));

var landsat8Features = landsatParaFeatures(colecaoLandsat8, 'Landsat 8', LIMIAR_NDWI_LANDSAT);
var landsat9Features = landsatParaFeatures(colecaoLandsat9, 'Landsat 9', LIMIAR_NDWI_LANDSAT);

var serie = sentinelFeatures
  .merge(landsat8Features)
  .merge(landsat9Features)
  .filter(ee.Filter.notNull(['area_ha']))
  .sort('data');

print('Cenas processadas', serie.size());
print('Amostra da série', serie.limit(10));

Export.table.toDrive({
  collection: serie,
  description: 'CUIDAI_Agua_Sao_Jose_III_Area_Superficial',
  fileNamePrefix: 'cuidai-agua-sao-jose-iii-area-superficial',
  fileFormat: 'CSV',
  selectors: [
    'data',
    'area_ha',
    'satellite',
    'cloud_pct',
    'valid_coverage_pct',
    'scene_id',
    'ndwi_threshold',
    'escala_m'
  ]
});

var ultimaSentinel = ee.Image(sentinelOriginal.sort('system:time_start', false).first());
var ndwiUltima = ultimaSentinel.normalizedDifference(['B3', 'B8']).rename('NDWI');
Map.addLayer(
  ndwiUltima,
  {min: -0.5, max: 0.5, palette: ['#A66A3F', '#E8E3D5', '#5AB8D7', '#075985']},
  'NDWI — última cena Sentinel-2'
);
