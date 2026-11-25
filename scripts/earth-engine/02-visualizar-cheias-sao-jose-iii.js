/**
 * CUIDAÍ | ÁGUA — ETAPA 2
 * Visualizar o Açude São José III em dois períodos de cheia documentada.
 *
 * FONTES PARA ESCOLHA DOS PERÍODOS:
 * - 27/04/2023: sangria confirmada pelo Governo do Ceará.
 * - 22/03/2026: boletim COGERH indica 103,16% da capacidade de referência.
 *
 * Atenção: as camadas são composições de várias cenas ao longo das datas
 * abaixo, não fotografias exatas dos dias de sangria. O contorno resultante
 * é um auxílio visual e ainda precisa de conferência.
 */

var pontoReferencia = ee.Geometry.Point([-40.7703, -4.8986]);
var areaVisualizacao = pontoReferencia.buffer(6500);

Map.setOptions('SATELLITE');
Map.centerObject(pontoReferencia, 13);

// Retira pixels classificados como nuvem, sombra e outros elementos inválidos.
function removerNuvens(imagem) {
  var scl = imagem.select('SCL');
  var limpa = scl.neq(1)
    .and(scl.neq(3))
    .and(scl.neq(8))
    .and(scl.neq(9))
    .and(scl.neq(10))
    .and(scl.neq(11));
  return imagem.updateMask(limpa);
}

function cenasDoPeriodo(dataInicial, dataFinal) {
  return ee.ImageCollection('COPERNICUS/S2_SR_HARMONIZED')
    .filterBounds(pontoReferencia)
    .filterDate(dataInicial, dataFinal)
    .filter(ee.Filter.lte('CLOUDY_PIXEL_PERCENTAGE', 85))
    .map(removerNuvens);
}

// 2026: logo após registro de nível acima da cota de sangria, 22/03/2026.
var cenas2026 = cenasDoPeriodo('2026-03-20', '2026-04-21');

// 2023: após início da sangria, confirmado em 27/04/2023.
var cenas2023 = cenasDoPeriodo('2023-04-27', '2023-06-01');

print('Cenas disponíveis — março/abril de 2026:', cenas2026.size());
print('Cenas disponíveis — abril/maio de 2023:', cenas2023.size());
print('Atenção: são composições de períodos, não imagens dos dias exatos.');

var visual = {
  bands: ['B4', 'B3', 'B2'],
  min: 100,
  max: 3500,
  gamma: 1.15
};

// O primeiro período aparece automaticamente no mapa.
Map.addLayer(
  cenas2026.median().clip(areaVisualizacao),
  visual,
  'CHEIA 2026 — março/abril (composição)',
  true,
  0.95
);

// Ligue esta camada em Layers para comparar com 2026.
Map.addLayer(
  cenas2023.median().clip(areaVisualizacao),
  visual,
  'CHEIA 2023 — abril/maio (composição)',
  false,
  0.95
);

// Marcador por último, para ficar na frente da imagem.
Map.addLayer(
  pontoReferencia,
  {color: 'FF453A'},
  'Ponto de referência do São José III'
);

print('Use Layers (canto superior direito) para alternar entre 2026 e 2023.');
print('Desenhe o polígono somente após inspecionar os braços do açude.');
