# CUIDAÍ | Água — arquitetura inicial

## Reservatório piloto
- Nome: Açude São José III.
- Município: Ipaporanga/CE.
- Capacidade nominal: 9,12 hm³, conforme ficha técnica da COGERH.
- Área da bacia hidrográfica: 99,35 km².
- Riacho barrado: Riacho São José.
- Coordenadas de referência: -4.8986, -40.7703, obtidas no documento de planejamento hídrico da COGERH.
- A coordenada é um ponto de referência; não substitui o polígono geográfico do espelho d'água.

## Camadas
1. Fontes: COGERH, Open-Meteo, Sentinel-2 L2A Harmonized, Landsat 8/9 C2 L2 e futura estação local.
2. Processamento: máscara de nuvens/sombras, NDWI, área superficial, evaporação de água livre e balanço hídrico.
3. Dados: reservatórios, leituras hidrometeorológicas, cenas processadas e estimativas com metadados de origem.
4. Aplicação: visão geral, ficha do reservatório, satélite, evaporação, meteorologia e relatórios.
5. Saídas: mapa, séries temporais, comparador, PDF e CSV.

## Coleções Firestore previstas
- reservatorios: cadastro e características técnicas.
- leiturasHidrometeorologicas: leituras de estação, com unidade, instante, equipamento e qualidade.
- analisesSuperficie: cenas processadas, área, sensor, cobertura de nuvens, método e imagem de prévia.
- estimativasEvaporacao: lâmina e volume estimados, método, parâmetros, intervalo e incerteza.

A implementação inicial mantém o cadastro do reservatório em configuração tipada e consulta meteorologia diretamente à Open-Meteo. As coleções acima definem o contrato futuro; regras e ingestão do Firestore serão configuradas antes de habilitar gravações.

## Regras de fidelidade
- Nunca preencher indicadores ausentes com números fictícios.
- Separar medição de sensor, dado oficial, estimativa de API, resultado de satélite e simulação.
- Cada série deve guardar fonte, data/hora, unidade, método, resolução e indicador de qualidade.
- Área superficial não equivale a volume armazenado.
- Variação de volume não equivale automaticamente a evaporação.
- ET₀ de referência não deve ser apresentada como evaporação direta de água livre.
- Cálculos volumétricos dependem da área inundada correspondente ao período.
- Estimativas de evaporação precisam de método para água livre e calibração local.

## Sensoriamento remoto
- Sentinel-2 L2A Harmonized é a fonte principal, com resolução de 10 m nas bandas usadas no NDWI e revisita nominal de cinco dias.
- Landsat 8/9 Collection 2 Level-2 complementa a série histórica, com resolução de 30 m nas bandas usadas no NDWI.
- A disponibilidade efetiva depende de cobertura de nuvens, sombras e cenas válidas.
- O script scripts/earth-engine/sao-jose-iii-area-series.js exporta uma tabela CSV de área superficial por aquisição.
- O polígono AOI precisa ser delimitado e validado manualmente no Earth Engine antes do primeiro processamento.
- O limiar NDWI inicial é provisório e precisa ser calibrado com imagens e referência de campo.

## Estação futura
Contrato de leitura previsto:
- temperatura do ar (°C);
- umidade relativa (%);
- velocidade e direção do vento (m/s, graus);
- radiação solar (W/m²);
- precipitação (mm);
- pressão atmosférica (hPa);
- nível da água (m);
- temperatura da água (°C, opcional);
- bateria, conectividade, identificação do sensor, instante e qualidade.

A estação não será considerada operacional até instalação, calibração e validação de transmissão.

## Primeira entrega
- Módulo web isolado no painel CUIDAÍ.
- Meteorologia estimada via Open-Meteo.
- Ficha técnica e localização do reservatório.
- Importação de série CSV produzida no Earth Engine.
- Gráfico com agregação diária, mensal ou anual por mediana.
- Comparação de duas cenas.
- Calculadora transparente de conversão de lâmina evaporada em volume.
- Exportação CSV e impressão para PDF.
