/**
 * CUIDAÍ | ÁGUA — ETAPA 4
 * Série anual 1985–2025 do Açude São José III pelo MapBiomas Água, Coleção 5.
 *
 * Este script NÃO classifica 41 anos de imagens do zero: usa o mapeamento
 * anual já publicado pelo MapBiomas (Landsat, resolução de 30 metros).
 *
 * INSTRUÇÃO ÚNICA:
 * Abra o script "02_Imagem_Cheia_2026" no Earth Engine, use Save as
 * para criar "04_MapBiomas_Historico" PRESERVANDO Imports -> geometry.
 * Substitua só o código principal por este script, clique Run e abra Tasks
 * para iniciar a exportação do CSV. NÃO redesenhe nenhum polígono.
 *
 * O polígono ainda é provisório: a série deve ser validada em períodos
 * de cheia, pois uma AOI muito justa corta água histórica.
 */

var aoi = geometry;
var assetId = 'projects/mapbiomas-public/assets/brazil/water/collection5/mapbiomas_brazil_collection5_water_annual_v4';
var imagemAnual = ee.Image(assetId);
var anos = ee.List.sequence(1985, 2025);

Map.setOptions('SATELLITE');
Map.centerObject(aoi, 13);

print('CUIDAÍ | Água — MapBiomas Água Coleção 5');
print('Banda amostra da base oficial:', imagemAnual.bandNames().slice(0, 3));
print('Área de estudo é o polígono geometry já salvo no Earth Engine.');

var serie = ee.FeatureCollection(anos.map(function(ano) {
  ano = ee.Number(ano);
  var banda = ee.String('classification_').cat(ano.format('%d'));

  // Classe 1 = superfície de água, conforme documentação MapBiomas.
  var aguaMapeada = imagemAnual.select(banda).eq(1);
  var hectares = ee.Image.pixelArea().divide(10000)
    .rename('area_ha')
    .updateMask(aguaMapeada);

  var estatisticas = hectares.reduceRegion({
    reducer: ee.Reducer.sum(),
    geometry: aoi,
    scale: 30,
    maxPixels: 1e8,
    tileScale: 4
  });

  var area = ee.Number(ee.Algorithms.If(
    estatisticas.get('area_ha'), estatisticas.get('area_ha'), 0
  ));

  return ee.Feature(null, {
    data: ee.Date.fromYMD(ano, 12, 31).format('YYYY-MM-dd'),
    ano: ano,
    area_ha: area,
    satellite: 'MapBiomas Água',
    source: 'MapBiomas Água - Coleção 5 (anual, 30 m)',
    scale_m: 30,
    scene_id: banda,
    geometry_status: 'AOI provisória; revisão requerida'
  });
}));

print('41 anos prontos para exportação (1985–2025).');
print('Amostra da série calculada:', serie.limit(5));
print('Último ano da série:', serie.filter(ee.Filter.eq('ano', 2025)));

var agua2025 = imagemAnual.select('classification_2025').eq(1)
  .selfMask().clip(aoi);
Map.addLayer(agua2025, {palette: ['118ED0']},
  'Água mapeada pelo MapBiomas em 2025', true, 0.78);

var borda = ee.Image().byte().paint(
  ee.FeatureCollection([ee.Feature(aoi)]), 1, 2
).selfMask();
Map.addLayer(borda, {palette: ['FF9A39']},
  'Contorno da área de estudo', true);

Export.table.toDrive({
  collection: serie,
  description: 'CUIDAI_AGUA_SAO_JOSE_III_MAPBIOMAS_1985_2025',
  folder: 'CUIDAI_AGUA',
  fileNamePrefix: 'cuidai-agua-sao-jose-iii-mapbiomas-1985-2025',
  fileFormat: 'CSV',
  selectors: ['data', 'ano', 'area_ha', 'satellite', 'source',
              'scale_m', 'scene_id', 'geometry_status']
});

print('Atenção: os valores são classificação ANUAL de água, não área');
print('instantânea da imagem, nem volume armazenado ou nível.');
print('Fonte: https://brasil.mapbiomas.org/');
