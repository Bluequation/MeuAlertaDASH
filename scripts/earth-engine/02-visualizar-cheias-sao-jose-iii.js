/**
 * CUIDAÍ | ÁGUA — Imagem única do Açude São José III em 2026
 *
 * Mostra UMA cena Sentinel-2 (sem composição / sem mediana / sem máscara RGB),
 * escolhida pela qualidade e cobertura junto ao açude após a sangria.
 * A data exata é impressa no Console. Não representa necessariamente
 * a data do nível máximo.
 *
 * Resolução das bandas B2, B3 e B4: 10 m por pixel.
 * Para comparar a nitidez com o Google Satélite, desligue a camada RGB
 * em "Layers". Não desenhe o contorno sem conferir a cena e as margens.
 */

var pontoReferencia = ee.Geometry.Point([-40.7703, -4.8986]);
var regiaoAvaliacao = pontoReferencia.buffer(3500);

Map.setOptions('SATELLITE');
Map.centerObject(pontoReferencia, 13);

function pontuarCena(imagem) {
  var scl = imagem.select('SCL');

  // SCL: 0 = sem dados, 1 = saturado/defeituoso,
  // 3 = sombra de nuvem, 8/9/10 = nuvens/cirrus.
  // O cálculo serve APENAS para escolher a cena; não recorta o RGB.
  var valido = scl.neq(0)
    .and(scl.neq(1))
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10));

  var proporcao = ee.Number(
    valido.unmask(0, false).rename('valido').reduceRegion({
      reducer: ee.Reducer.mean(),
      geometry: regiaoAvaliacao,
      scale: 60,
      maxPixels: 100000,
      bestEffort: true,
      tileScale: 2
    }).get('valido', 0)
  );

  return imagem.set('proporcao_valida_local', proporcao);
}

// Período posterior à sangria registrada em março/2026.
var candidatas = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(regiaoAvaliacao)
  .filterDate('2026-03-20', '2026-05-15')
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 95))
  .map(pontuarCena)
  .sort('proporcao_valida_local', false);

print('Quantidade de cenas avaliadas:', candidatas.size());

var cena2026 = ee.Image(candidatas.first());

print('Data EXATA da cena escolhida:',
  ee.Date(cena2026.get('system:time_start')).format('dd/MM/yyyy'));
print('Pixels válidos na região de avaliação (%):',
  ee.Number(cena2026.get('proporcao_valida_local')).multiply(100).format('%.1f'));
print('Nuvens na cena completa (%):',
  cena2026.get('CLOUDY_PIXEL_PERCENTAGE'));

// Uma única imagem RGB. Sem median(), mosaic() ou máscara de nuvens.
Map.addLayer(
  cena2026,
  {bands: ['B4', 'B3', 'B2'], min: 0, max: 3500, gamma: 1.15},
  'SÃO JOSÉ III — UMA IMAGEM DE 2026',
  true,
  0.90
);

// Opcional: ponto desligado, pois pode encobrir a superfície da água.
Map.addLayer(
  pontoReferencia,
  {color: 'FF453A'},
  'Ponto vermelho de referência',
  false
);

print('Em Layers, desative a imagem de 2026 para ver o fundo Google Satélite.');
print('O Sentinel-2 tem pixels de 10 m e ficará menos nítido se ampliar muito.');
print('Esta etapa serve para INSPEÇÃO visual, não para volume/área oficiais.');
