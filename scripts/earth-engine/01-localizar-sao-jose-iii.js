/**
 * CUIDAÍ | ÁGUA — ETAPA 1: LOCALIZAR E CONFERIR O AÇUDE SÃO JOSÉ III
 *
 * Este arquivo NÃO calcula área nem volume. Ele serve somente para
 * encontrar a região, conferir uma cena real do Sentinel-2 e
 * ajudar a desenhar corretamente o polígono do reservatório.
 *
 * COMO USAR:
 * 1. Abra https://code.earthengine.google.com/
 * 2. Cole todo este código no editor e clique Run.
 * 3. Veja o ponto vermelho, confira a imagem de satélite e localize o açude.
 *    IMPORTANTE: o ponto é uma REFERÊNCIA e pode não ser o centro do lago.
 * 4. Desenhe um polígono AOI envolvendo a extensão máxima conhecida do açude.
 *    NÃO use o ponto como se fosse o contorno.
 * 5. Salve o polígono para usar no script de série histórica.
 *
 * Fonte do ponto de referência: documento de planejamento da COGERH.
 * Qualquer classificação preliminar da água precisa ser validada com
 * imagens, contexto local e controle de nuvens antes de gerar relatórios.
 */

var pontoReferencia = ee.Geometry.Point([-40.7703, -4.8986]);
var areaBusca = pontoReferencia.buffer(12000);
var fim = ee.Date(Date.now()).advance(1, 'day');
var inicio = fim.advance(-12, 'month');

Map.setOptions('SATELLITE');
Map.centerObject(pontoReferencia, 12);

var imagens = ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
  .filterBounds(areaBusca)
  .filterDate(inicio, fim)
  .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 50));

print('Quantidade de imagens candidatas (últimos 12 meses):', imagens.size());

var melhorCena = ee.Image(imagens.sort('CLOUDY_PIXEL_PERCENTAGE').first());

print('Data da cena selecionada:', ee.Date(melhorCena.get('system:time_start')).format('dd/MM/YYYY'));
print('Cobertura de nuvens da cena completa (%):', melhorCena.get('CLOUDY_PIXEL_PERCENTAGE'));

Map.addLayer(
  melhorCena.clip(areaBusca),
  { bands: ['B4', 'B3', 'B2'], min: 0, max: 3500 },
  'Sentinel-2: composição colorida (opcional)',
  false, // inicia desligada para não cobrir o marcador de referência
  0.75
);

var ndwi = melhorCena.normalizedDifference(['B3', 'B8']).rename('NDWI');
Map.addLayer(
  ndwi.gt(0).selfMask().clip(areaBusca),
  { palette: ['18A7D8'] },
  'Água potencial (NDWI > 0; NÃO VALIDADA)',
  false
);

// O marcador vem por ÚLTIMO para ficar visível por cima das imagens.
Map.addLayer(
  ee.FeatureCollection([ee.Feature(pontoReferencia)]).style({
    color: 'FF453A',
    pointSize: 11,
    pointShape: 'circle',
    width: 3,
    fillColor: 'FF453A'
  }),
  {},
  'Ponto vermelho — referência, confirmar local'
);

print('Ponto de referência (longitude, latitude): -40.7703, -4.8986');
print('Verifique visualmente o açude antes de desenhar o contorno.');

// Próxima etapa:
// scripts/earth-engine/sao-jose-iii-area-series.js
// Nesse segundo script, a variável "geometry" deverá ser o polígono
// validado do reservatório, desenhado/importado no Code Editor.
