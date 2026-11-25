/**
 * CUIDAÍ | ÁGUA — série anual 1985–2025 do Açude São José III.
 *
 * Base: MapBiomas Água, Coleção 5, 30 m, Landsat.
 * Asset: projects/mapbiomas-public/assets/brazil/water/collection5/mapbiomas_brazil_collection5_water_annual_v4
 * Classe 1 = superfície de água. Na Caatinga, a classificação anual
 * considera água detectada em pelo menos seis meses do ano.
 *
 * No Code Editor, abra 02_Imagem_Cheia_2026, use Save as para criar
 * 04_MapBiomas_Historico e preserve Imports -> geometry. Substitua apenas
 * o código principal por este script. O polígono importado (411 vértices)
 * não deve ser redesenhado ou alterado nesta etapa.
 *
 * Limites: a área contabiliza pixels classificados como água dentro da AOI.
 * O asset é um mapa binário de ocorrência, não uma máscara de observabilidade;
 * portanto não se calcula cobertura válida a partir da máscara. Ausência de
 * pixels mapeados não confirma que o açude estava seco. O polígono pode também
 * excluir água histórica se estiver justo demais. O produto não estima volume,
 * cota ou nível e a área pode diferir de uma cena instantânea.
 */

var aoi = geometry;
var assetId = 'projects/mapbiomas-public/assets/brazil/water/collection5/mapbiomas_brazil_collection5_water_annual_v4';
var imagemAnual = ee.Image(assetId);
var anos = ee.List.sequence(1985, 2025);

Map.setOptions('SATELLITE');
Map.centerObject(aoi, 13);

print('CUIDAÍ | Água — MapBiomas Água Coleção 5');
print('Asset:', assetId);
print('Bandas:', imagemAnual.bandNames());
print('Área da AOI original (ha):', ee.Number(aoi.area(1)).divide(10000));
print('Bandas 1985 e 2025 presentes:', imagemAnual.bandNames().contains('classification_1985'), imagemAnual.bandNames().contains('classification_2025'));

var serie = ee.FeatureCollection(anos.map(function(ano) {
  ano = ee.Number(ano);
  var banda = ee.String('classification_').cat(ano.format('%.0f'));
  var agua = imagemAnual.select(banda).eq(1);
  var areaStats = ee.Image.pixelArea().divide(10000).rename('area_ha')
    .updateMask(agua)
    .reduceRegion({
      reducer: ee.Reducer.sum(),
      geometry: aoi,
      scale: 30,
      maxPixels: 1e8,
      tileScale: 4
    });
  var areaAguaHa = ee.Algorithms.If(
    ee.Algorithms.IsEqual(areaStats.get('area_ha'), null),
    null,
    areaStats.get('area_ha')
  );

  return ee.Feature(null, {
    data: ee.Date.fromYMD(ano, 12, 31).format('YYYY-MM-dd'),
    ano: ano,
    area_ha: areaAguaHa,
    satellite: 'MapBiomas Água',
    source: 'MapBiomas Água - Coleção 5 (anual, Landsat, 30 m)',
    scale_m: 30,
    scene_id: banda,
    data_interpretation: 'Área mapeada como água (classe 1); pixels sem água mapeada não indicam ausência confirmada',
    geometry_status: 'geometry original de 02_Imagem_Cheia_2026; 411 vértices'
  });
}));

print('Número de anos (esperado 41):', serie.size());
print('Série anual completa:', serie.sort('ano'));
print('Resumo estatístico da área mapeada:', serie.aggregate_stats('area_ha'));
print('Pixels classificados como água em 2025:', imagemAnual.select('classification_2025').reduceRegion({
  reducer: ee.Reducer.frequencyHistogram(),
  geometry: aoi,
  scale: 30,
  maxPixels: 1e8,
  tileScale: 4
}));

var agua2025 = imagemAnual.select('classification_2025').eq(1).selfMask().clip(aoi);
Map.addLayer(agua2025, {palette: ['118ED0']}, 'MapBiomas Água — 2025 (classe 1)', true, 0.78);

var borda = ee.Image().byte().paint(
  ee.FeatureCollection([ee.Feature(aoi)]), 1, 2
).selfMask();
Map.addLayer(borda, {palette: ['FF9A39']}, 'Contorno original da AOI (411 vértices)', true);

Export.table.toDrive({
  collection: serie,
  description: 'CUIDAI_AGUA_SAO_JOSE_III_MAPBIOMAS_1985_2025',
  folder: 'CUIDAI_AGUA',
  fileNamePrefix: 'cuidai-agua-sao-jose-iii-mapbiomas-1985-2025',
  fileFormat: 'CSV',
  selectors: [
    'data', 'ano', 'area_ha', 'satellite', 'source', 'scale_m',
    'scene_id', 'data_interpretation', 'geometry_status'
  ]
});

print('Limitação científica: produto anual de área classificada como água; não fornece volume ou cota. Ausência de pixels mapeados não é prova de reservatório seco.');
print('Fonte: https://brasil.mapbiomas.org/');