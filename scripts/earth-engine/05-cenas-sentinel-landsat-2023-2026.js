/**
 * CUIDAÍ | ÁGUA — ETAPA 5
 * Processamento de cenas Sentinel-2 e Landsat 8/9 no Açude São José III.
 * Período-piloto 2023–25/11/2026. UMA exportação, com as duas fontes.
 *
 * No Earth Engine, copie o script 02_Imagem_Cheia_2026 (Save as)
 * e cole este código mantendo Imports -> geometry (411 vértices).
 *
 * NDWI > 0 é um limiar EXPERIMENTAL, não uma área validada:
 * -> máscaras de nuvem/sombra e pixels fora da cena são aplicadas;
 * -> SCL: sem dados, defeito, sombra de nuvem, não classificado, nuvem/cirrus e neve/gelo são descartados;
 * -> registros com cobertura válida inferior a 85% são DESCARTADOS;
 * -> dados Sentinel-2 (10 m) e Landsat (30 m) são identificados separadamente;
 * -> não calcular volume com estes valores sem curva cota-área-volume.
 *
 * O MapBiomas anual não é reutilizado como se fosse dado por cena.
 * Usar o CSV com rastreabilidade e validação visual antes de divulgação pública.
 */

var aoi = geometry;
var INICIO = '2023-01-01';
var FIM = '2026-11-26'; // exclusivo: até 25/11/2026
var LIMITE_NUVENS = 60; // filtro bruto da cena, não da AOI
var COBERTURA_MINIMA_PCT = 85;
var LIMIAR_NDWI_S2 = 0;
var LIMIAR_NDWI_LANDSAT = 0;

Map.setOptions('SATELLITE');
Map.centerObject(aoi, 13);

function gerarRegistro(imagem, verde, nir, escala, sensor, nuvens, limiar) {
  // O retorno de copyProperties pode perder a inferência de tipo no EE.
  imagem = ee.Image(imagem);
  var green = imagem.select(verde);
  var nearInfrared = imagem.select(nir);
  var denom = green.add(nearInfrared);

  // Expressão evita a máscara automática de reflectâncias negativas.
  var ndwi = imagem.expression('(g - n) / (g + n)', {
    g: green,
    n: nearInfrared
  }).rename('NDWI').updateMask(denom.neq(0));

  var agua = ndwi.gt(limiar);
  var metroQuadrado = ee.Image.pixelArea();

  var resultado = ee.Image.cat([
    metroQuadrado.updateMask(agua).rename('agua_m2'),
    metroQuadrado.updateMask(ndwi.mask()).rename('valido_m2')
  ]).reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: aoi,
    scale: escala,
    maxPixels: 1e9,
    tileScale: 4
  });

  var aguaM2 = ee.Number(ee.Algorithms.If(
    resultado.get('agua_m2'), resultado.get('agua_m2'), 0
  ));
  var validoM2 = ee.Number(ee.Algorithms.If(
    resultado.get('valido_m2'), resultado.get('valido_m2'), 0
  ));
  var coberturaPct = validoM2.divide(ee.Number(aoi.area(1))).multiply(100);

  return ee.Feature(null, {
    data: ee.Date(imagem.get('system:time_start')).format('YYYY-MM-dd'),
    area_ha: ee.Algorithms.If(validoM2.gt(0), aguaM2.divide(10000), null),
    satellite: sensor,
    scene_id: imagem.get('system:index'),
    cloud_pct: nuvens,
    valid_coverage_pct: coberturaPct,
    ndwi_threshold: limiar,
    scale_m: escala
  });
}

var s2 = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(aoi).filterDate(INICIO, FIM)
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', LIMITE_NUVENS));

var s2Features = ee.FeatureCollection(s2.toList(s2.size()).map(function(obj) {
  var img = ee.Image(obj);
  var scl = img.select('SCL');
  // 0: sem dados, 1: defeito, 3: sombra, 7: incerto,
  // 8–10: nuvem/cirrus, 11: neve/gelo.
  var qualidade = scl.neq(0).and(scl.neq(1)).and(scl.neq(3))
    .and(scl.neq(7)).and(scl.neq(8)).and(scl.neq(9))
    .and(scl.neq(10)).and(scl.neq(11));
  return gerarRegistro(
    img.updateMask(qualidade), 'B3', 'B8', 10, 'Sentinel-2',
    img.get('CLOUDY_PIXEL_PERCENTAGE'), LIMIAR_NDWI_S2
  );
}));

function landsatRegistros(asset) {
  var colecao = ee.ImageCollection(asset)
    .filterBounds(aoi).filterDate(INICIO, FIM)
    .filter(ee.Filter.lte('CLOUD_COVER', LIMITE_NUVENS));

  return ee.FeatureCollection(colecao.toList(colecao.size()).map(function(obj) {
    var img = ee.Image(obj);
    var qa = img.select('QA_PIXEL');
    // Bits 0–5: fill, dilated cloud, cirrus, cloud, shadow, snow.
    var qualidade = qa.bitwiseAnd(63).eq(0)
      .and(img.select('QA_RADSAT').eq(0));

    // Correção de escala e deslocamento oficial Landsat C2 L2.
    var reflectancia = img.select(['SR_B3', 'SR_B5'])
      .multiply(0.0000275).add(-0.2)
      .rename(['green', 'nir'])
      .updateMask(qualidade);

    return gerarRegistro(
      reflectancia.copyProperties(img, ['system:time_start', 'system:index']),
      'green', 'nir', 30, 'Landsat', img.get('CLOUD_COVER'),
      LIMIAR_NDWI_LANDSAT
    );
  }));
}

var landsat8 = landsatRegistros('LANDSAT/LC08/C02/T1_L2');
var landsat9 = landsatRegistros('LANDSAT/LC09/C02/T1_L2');

var candidatos = s2Features.merge(landsat8).merge(landsat9)
  .filter(ee.Filter.notNull(['area_ha']));
var registros = candidatos
  .filter(ee.Filter.gte('valid_coverage_pct', COBERTURA_MINIMA_PCT))
  .sort('data');

var sentinelValido = registros.filter(ee.Filter.eq('satellite', 'Sentinel-2'));
var landsatValido = registros.filter(ee.Filter.eq('satellite', 'Landsat'));

print('CUIDAÍ | Água — cenas candidatas com algum pixel válido:', candidatos.size());
print('Cenas rejeitadas por cobertura abaixo de 85%:', candidatos.filter(ee.Filter.lt('valid_coverage_pct', COBERTURA_MINIMA_PCT)).size());
print('Cenas exportadas após filtro de cobertura:', registros.size());
print('Sentinel-2 exportadas:', sentinelValido.size());
print('Landsat 8/9 exportadas:', landsatValido.size());
print('Intervalo de datas exportado:', registros.aggregate_min('data'), registros.aggregate_max('data'));
print('Sentinel-2 — cobertura válida min/max (%):', sentinelValido.aggregate_min('valid_coverage_pct'), sentinelValido.aggregate_max('valid_coverage_pct'));
print('Landsat 8/9 — cobertura válida min/max (%):', landsatValido.aggregate_min('valid_coverage_pct'), landsatValido.aggregate_max('valid_coverage_pct'));
print('Sentinel-2 — área NDWI min/max (ha):', sentinelValido.aggregate_min('area_ha'), sentinelValido.aggregate_max('area_ha'));
print('Landsat 8/9 — área NDWI min/max (ha):', landsatValido.aggregate_min('area_ha'), landsatValido.aggregate_max('area_ha'));
print('Área da AOI original (ha):', ee.Number(aoi.area(1)).divide(10000));
print('Amostra das primeiras cenas:', registros.limit(5));
print('IMPORTANTE: NDWI > 0 preliminar, sujeito a falsos positivos/negativos e efeitos de mistura de pixels. Não é volume nem série validada.');

var colunas = [
  'data', 'area_ha', 'satellite', 'scene_id', 'cloud_pct',
  'valid_coverage_pct', 'ndwi_threshold', 'scale_m'
];

Export.table.toDrive({
  collection: registros,
  description: 'CUIDAI_SAO_JOSE_III_SENTINEL_LANDSAT_2023_2026',
  folder: 'CUIDAI_AGUA',
  fileNamePrefix: 'cuidai-agua-sao-jose-iii-cenas-2023-2026',
  fileFormat: 'CSV',
  selectors: colunas
});

print('CSV preparado no Tasks para exportação ao Drive; validar visualmente as cenas antes de interpretar as áreas como superfície real.');
