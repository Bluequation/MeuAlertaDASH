
/*
 * CUIDAÍ — OBSERVATÓRIO MUNICIPAL
 * Relatório de histórico meteorológico
 *
 * Gera um documento A4 utilizando as leituras
 * já carregadas do Firebase pelo painel.
 */

type EstacaoRelatorio = {
    id: string;
    nome: string;
    municipio: string;
};

type LeituraRelatorio = {
    recebidoEm: number;
    temperatura: number;
    umidade: number;
};

// Protege os textos inseridos no HTML.
function escaparHTML(texto: string): string {
    const entidades: Record<string, string> = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };

    return texto.replace(
        /[&<>"']/g,
        caractere => entidades[caractere] ?? caractere
    );
}

// Formatação numérica brasileira.
function formatarNumero(valor: number): string {
    return valor.toLocaleString('pt-BR', {
        minimumFractionDigits: 1,
        maximumFractionDigits: 1
    });
}

// Datas no horário oficial do Ceará.
function formatarData(data: number): string {
    return new Date(data).toLocaleString('pt-BR', {
        timeZone: 'America/Fortaleza',
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hour12: false
    });
}

// Gráficos SVG para impressão.
function gerarGrafico(
    leituras: LeituraRelatorio[],
    campo: 'temperatura' | 'umidade',
    titulo: string,
    unidade: string,
    cor: string
): string {

    if (leituras.length < 2) {
        return `
            <section class="grafico">
                <h2>${escaparHTML(titulo)}</h2>
                <p class="mensagem">
                    São necessárias pelo menos duas
                    medições para construir o gráfico.
                </p>
            </section>
        `;
    }

    const valores = leituras.map(
        leitura => leitura[campo]
    );

    const minimo = Math.min(...valores);
    const maximo = Math.max(...valores);

    const margem = Math.max(
        (maximo - minimo) * 0.15,
        campo === 'temperatura' ? 0.5 : 1
    );

    const limiteInferior = minimo - margem;
    const limiteSuperior = maximo + margem;

    const primeiroTempo = leituras[0].recebidoEm;
    const ultimoTempo =
        leituras[leituras.length - 1].recebidoEm;

    const duracao = ultimoTempo - primeiroTempo;

    const obterX = (
        leitura: LeituraRelatorio,
        indice: number
    ): number => {

        const proporcao = duracao > 0
            ? (leitura.recebidoEm - primeiroTempo) / duracao
            : indice / (leituras.length - 1);

        return 65 + proporcao * 630;
    };

    const obterY = (valor: number): number => {
        const proporcao =
            (valor - limiteInferior) /
            (limiteSuperior - limiteInferior);

        return 180 - proporcao * 145;
    };

    const pontos = leituras.map(
        (leitura, indice) => {

            const x = obterX(leitura, indice);
            const y = obterY(leitura[campo]);

            return `${x.toFixed(1)},${y.toFixed(1)}`;
        }
    ).join(' ');

    const grades = [0, 0.5, 1].map(fracao => {

        const y = 180 - fracao * 145;

        const valor =
            limiteInferior +
            fracao * (limiteSuperior - limiteInferior);

        return `
            <line
                x1="65"
                x2="695"
                y1="${y}"
                y2="${y}"
                stroke="#E1EAF2"
                stroke-dasharray="4 5"
            />

            <text
                x="55"
                y="${y + 4}"
                text-anchor="end"
                fill="#718397"
                font-size="12"
            >
                ${formatarNumero(valor)}
            </text>
        `;
    }).join('');

    // Exibe marcadores somente para séries menores.
    const marcadores = leituras.length <= 20
        ? leituras.map((leitura, indice) => `
            <circle
                cx="${obterX(leitura, indice)}"
                cy="${obterY(leitura[campo])}"
                r="3"
                fill="#FFFFFF"
                stroke="${cor}"
                stroke-width="2"
            />
        `).join('')
        : '';

    const dataInicial = escaparHTML(
        formatarData(primeiroTempo)
    );

    const dataFinal = escaparHTML(
        formatarData(ultimoTempo)
    );

    return `
        <section class="grafico">

            <div class="grafico-cabecalho">
                <h2>${escaparHTML(titulo)}</h2>
                <span>${escaparHTML(unidade)}</span>
            </div>

            <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 740 225"
                role="img"
                aria-label="${escaparHTML(titulo)}"
            >

                ${grades}

                <polyline
                    points="${pontos}"
                    fill="none"
                    stroke="${cor}"
                    stroke-width="3"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />

                ${marcadores}

                <text
                    x="65"
                    y="212"
                    fill="#718397"
                    font-size="11"
                >
                    ${dataInicial}
                </text>

                <text
                    x="695"
                    y="212"
                    text-anchor="end"
                    fill="#718397"
                    font-size="11"
                >
                    ${dataFinal}
                </text>

            </svg>

        </section>
    `;
}

// FUNÇÃO PRINCIPAL — EXPORTADA PARA O HISTÓRICO.
export function abrirRelatorioHistorico(
    estacao: EstacaoRelatorio,
    leituras: LeituraRelatorio[]
): void {

    if (leituras.length === 0) {
        window.alert(
            'Não há medições disponíveis para gerar o relatório.'
        );
        return;
    }

    // Organiza as leituras da mais antiga para a recente.
    const dados = [...leituras].sort(
        (a, b) => a.recebidoEm - b.recebidoEm
    );

    const primeira = dados[0];
    const ultima = dados[dados.length - 1];

    // Abre o relatório em uma guia separada.
    const janela = window.open(
        '',
        '_blank',
        'width=980,height=760'
    );

    if (!janela) {
        window.alert(
            'O navegador bloqueou a abertura do relatório. ' +
            'Permita pop-ups para este site.'
        );
        return;
    }

    janela.opener = null;

    // Constrói a tabela com todas as leituras carregadas.
    const linhasTabela = dados.map(leitura => `
        <tr>
            <td>
                ${escaparHTML(
        formatarData(leitura.recebidoEm)
    )}
            </td>

            <td class="numero">
                ${formatarNumero(leitura.temperatura)}
            </td>

            <td class="numero">
                ${formatarNumero(leitura.umidade)}
            </td>
        </tr>
    `).join('');

    // Estatísticas simples do período.
    const temperaturas = dados.map(
        leitura => leitura.temperatura
    );

    const umidades = dados.map(
        leitura => leitura.umidade
    );

    const temperaturaMinima = Math.min(
        ...temperaturas
    );

    const temperaturaMaxima = Math.max(
        ...temperaturas
    );

    const temperaturaMedia =
        temperaturas.reduce(
            (soma, valor) => soma + valor,
            0
        ) / temperaturas.length;

    const umidadeMedia =
        umidades.reduce(
            (soma, valor) => soma + valor,
            0
        ) / umidades.length;

    // Documento completo para impressão.
    const html = `
<!DOCTYPE html>
<html lang="pt-BR">

<head>
    <meta charset="UTF-8">

    <meta
        name="viewport"
        content="width=device-width, initial-scale=1"
    >

    <title>
        Relatório CUIDAÍ — ${escaparHTML(estacao.nome)}
    </title>

    <style>

        @page {
            size: A4 portrait;
            margin: 14mm;
        }

        * {
            box-sizing: border-box;
        }

        body {
            font-family:
                Arial,
                Helvetica,
                sans-serif;

            color: #192942;
            background: #FFFFFF;

            max-width: 900px;
            margin: 28px auto;
            padding: 0 20px;
        }

        .acoes {
            margin-bottom: 24px;
            display: flex;
            gap: 10px;
        }

        .botao {
            background: #192942;
            color: #FFFFFF;

            border: none;
            border-radius: 9px;

            padding: 12px 18px;

            font-size: 13px;
            font-weight: bold;

            cursor: pointer;
        }

        .botao:hover {
            background: #294466;
        }

        .cabecalho {
            padding-bottom: 19px;
            border-bottom: 2px solid #E0EAF3;
        }

        .marca {
            color: #168FC4;

            font-size: 10px;
            font-weight: 800;
            letter-spacing: 1.2px;

            margin-bottom: 8px;
        }

        h1 {
            font-size: 24px;
            line-height: 1.25;

            margin: 0 0 7px;
        }

        .subtitulo {
            color: #718397;
            font-size: 12px;
            margin: 0;
        }

        .informacoes {
            display: grid;

            grid-template-columns: 1fr 1fr;
            gap: 10px;

            margin: 18px 0;
        }

        .informacao {
            background: #F4F8FC;

            border: 1px solid #E0EAF3;
            border-radius: 10px;

            padding: 13px;
        }

        .rotulo {
            display: block;

            color: #718397;

            font-size: 10px;
            margin-bottom: 6px;
        }

        .informacao strong {
            font-size: 13px;
            overflow-wrap: anywhere;
        }

        .secao {
            margin-top: 22px;
        }

        .secao h2 {
            font-size: 15px;
            margin-bottom: 12px;
        }

        .indicadores {
            display: grid;

            grid-template-columns: repeat(4, 1fr);
            gap: 9px;

            margin-top: 12px;
        }

        .indicador {
            border: 1px solid #E0EAF3;
            border-radius: 10px;

            padding: 12px;
            background: #F8FAFD;
        }

        .indicador span {
            display: block;
            color: #718397;
            font-size: 10px;
            margin-bottom: 8px;
        }

        .indicador strong {
            font-size: 19px;
            color: #192942;
        }

        .grafico {
            border: 1px solid #DFE8F2;
            border-radius: 12px;

            padding: 14px;
            margin-top: 13px;

            break-inside: avoid;
            page-break-inside: avoid;
        }

        .grafico-cabecalho {
            display: flex;
            align-items: center;
            justify-content: space-between;
        }

        .grafico-cabecalho h2 {
            font-size: 15px;
            margin: 0;
        }

        .grafico-cabecalho span {
            color: #718397;
            font-size: 11px;
        }

        svg {
            display: block;
            width: 100%;
            height: auto;
        }

        .mensagem {
            font-size: 12px;
            color: #718397;
            margin-top: 12px;
        }

        table {
            width: 100%;
            border-collapse: collapse;

            font-size: 11px;
        }

        thead {
            display: table-header-group;
        }

        th {
            background: #EDF5FB;
            color: #355A77;

            font-weight: bold;
            text-align: left;
        }

        th,
        td {
            padding: 9px 10px;
            border-bottom: 1px solid #E3EBF3;
        }

        th.numero,
        td.numero {
            text-align: right;
            font-variant-numeric: tabular-nums;
        }

        tr {
            break-inside: avoid;
        }

        .rodape {
            margin-top: 22px;
            padding-top: 14px;

            border-top: 1px solid #DEE8F1;

            color: #718397;
            font-size: 10px;
            line-height: 1.7;
        }
            .rodape p {
    margin: 5px 0 0;
    line-height: 1.55;
}

.rodape strong {
    color: #355A77;
}

        @media print {

            body {
                max-width: none;
                margin: 0;
                padding: 0;
            }

            .acoes {
                display: none;
            }

            .informacao,
            .indicador {
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
        }

        @media (max-width: 600px) {

            .informacoes {
                grid-template-columns: 1fr;
            }

            .indicadores {
                grid-template-columns: repeat(2, 1fr);
            }
        }

    </style>
</head>

<body>

    <div class="acoes">
        <button
            id="imprimir-relatorio"
            class="botao"
            type="button"
        >
            Imprimir / Salvar em PDF
        </button>
    </div>

    <header class="cabecalho">

        <div class="marca">
            CUIDAÍ | OBSERVATÓRIO MUNICIPAL
        </div>

        <h1>
            Relatório meteorológico
        </h1>

        <p class="subtitulo">
            Histórico de medições da estação CUIDAÍ
        </p>

    </header>

    <section class="informacoes">

        <div class="informacao">
            <span class="rotulo">
                Estação meteorológica
            </span>

            <strong>
                ${escaparHTML(estacao.nome)}
            </strong>
        </div>

        <div class="informacao">
            <span class="rotulo">
                Município
            </span>

            <strong>
                ${escaparHTML(estacao.municipio)}
            </strong>
        </div>

        <div class="informacao">
            <span class="rotulo">
                Medições disponíveis
            </span>

            <strong>
                ${dados.length} registros
            </strong>
        </div>

        <div class="informacao">
            <span class="rotulo">
                Período analisado — Fortaleza
            </span>

            <strong>
                ${escaparHTML(
        formatarData(primeira.recebidoEm)
    )}
                até
                ${escaparHTML(
        formatarData(ultima.recebidoEm)
    )}
            </strong>
        </div>

    </section>

    <section class="secao">

        <h2>
            Resumo das medições
        </h2>

        <div class="indicadores">

            <div class="indicador">
                <span>Temp. mínima</span>

                <strong>
                    ${formatarNumero(temperaturaMinima)} °C
                </strong>
            </div>

            <div class="indicador">
                <span>Temp. média</span>

                <strong>
                    ${formatarNumero(temperaturaMedia)} °C
                </strong>
            </div>

            <div class="indicador">
                <span>Temp. máxima</span>

                <strong>
                    ${formatarNumero(temperaturaMaxima)} °C
                </strong>
            </div>

            <div class="indicador">
                <span>Umidade média</span>

                <strong>
                    ${formatarNumero(umidadeMedia)} %
                </strong>
            </div>

        </div>

    </section>

    <section class="secao">

        <h2>
            Evolução meteorológica
        </h2>

        ${gerarGrafico(
        dados,
        'temperatura',
        'Evolução da temperatura',
        '°C',
        '#DC7A40'
    )}

        ${gerarGrafico(
        dados,
        'umidade',
        'Evolução da umidade relativa',
        '%',
        '#348CCB'
    )}

    </section>

    <section class="secao">

        <h2>
            Tabela de medições
        </h2>

        <table>

            <thead>
                <tr>
                    <th>
                        Data e hora
                    </th>

                    <th class="numero">
                        Temperatura (°C)
                    </th>

                    <th class="numero">
                        Umidade (%)
                    </th>
                </tr>
            </thead>

            <tbody>
                ${linhasTabela}
            </tbody>

        </table>

    </section>

    <footer class="rodape">

    <strong>Fonte e metodologia</strong>

    <p>
        Dados da estação meteorológica CUIDAÍ,
        armazenados no Firebase.
        São medições de sensores, não estimativas
        da Open-Meteo.
    </p>

    <p>
        O relatório apresenta
        ${dados.length} registros válidos
        (limite de 72).
        Os gráficos conectam medições disponíveis,
        sem representar observação contínua.
        As médias são calculadas por registro,
        sem ponderação pelo tempo.
    </p>

    <p>
        <strong>Horário:</strong> America/Fortaleza
        &nbsp;•&nbsp;
        <strong>Emissão:</strong>
        ${escaparHTML(formatarData(Date.now()))}
    </p>

</footer>

</body>
</html>
    `;

    janela.document.open();
    janela.document.write(html);
    janela.document.close();

    const botao = janela.document.getElementById(
        'imprimir-relatorio'
    );

    botao?.addEventListener('click', () => {
        janela.print();
    });

    janela.focus();
}
