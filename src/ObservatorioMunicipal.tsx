
import { useState } from 'react';

type AbaObservatorio =
    | 'agora'
    | 'estacoes'
    | 'historico'
    | 'comparar';

type Props = {
    municipio: string;
    uf: string;
};

const ABAS: { id: AbaObservatorio; nome: string }[] = [
    { id: 'agora', nome: 'Agora' },
    { id: 'estacoes', nome: 'Estações' },
    { id: 'historico', nome: 'Histórico' },
    { id: 'comparar', nome: 'Comparar' }
];

const INDICADORES = [
    { titulo: 'Temperatura', unidade: '°C' },
    { titulo: 'Sensação térmica', unidade: '°C' },
    { titulo: 'Umidade relativa', unidade: '%' },
    { titulo: 'Velocidade do vento', unidade: 'km/h' }
];

export default function ObservatorioMunicipal({
    municipio,
    uf
}: Props) {
    const [aba, setAba] =
        useState<AbaObservatorio>('agora');

    return (
        <section className="obs-municipal">

            <header className="obs-cabecalho">
                <div className="obs-sobretitulo">
                    CUIDAÍ | OBSERVATÓRIO MUNICIPAL
                </div>

                <h3>{municipio}, {uf}</h3>

                <p>
                    Investigação meteorológica do território
                </p>

                <span className="obs-situacao">
                    Preparando indicadores
                </span>
            </header>

            <nav
                className="obs-abas"
                aria-label="Análises meteorológicas"
            >
                {ABAS.map(item => (
                    <button
                        key={item.id}
                        type="button"
                        className={
                            aba === item.id
                                ? 'obs-aba obs-aba--ativa'
                                : 'obs-aba'
                        }
                        aria-pressed={aba === item.id}
                        onClick={() => setAba(item.id)}
                    >
                        {item.nome}
                    </button>
                ))}
            </nav>

            <div className="obs-conteudo">

                {aba === 'agora' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Condições meteorológicas</h4>
                            <span>Open-Meteo</span>
                        </div>

                        <div className="obs-grade-indicadores">
                            {INDICADORES.map(indicador => (
                                <article
                                    className="obs-indicador"
                                    key={indicador.titulo}
                                >
                                    <div className="obs-indicador-titulo">
                                        {indicador.titulo}
                                    </div>

                                    <div className="obs-indicador-valor">
                                        —
                                        <small>{indicador.unidade}</small>
                                    </div>

                                    <div className="obs-indicador-nota">
                                        Aguardando integração
                                    </div>
                                </article>
                            ))}
                        </div>

                        <article className="obs-bloco">
                            <div className="obs-bloco-cabecalho">
                                <h4>Perfil térmico</h4>
                                <span>Análise territorial</span>
                            </div>

                            <div className="obs-estatisticas">
                                <div>
                                    <small>Mínima</small>
                                    <strong>—</strong>
                                </div>

                                <div>
                                    <small>Média</small>
                                    <strong>—</strong>
                                </div>

                                <div>
                                    <small>Máxima</small>
                                    <strong>—</strong>
                                </div>
                            </div>

                            <p>
                                Aqui serão apresentadas estatísticas
                                calculadas a partir dos pontos
                                meteorológicos amostrados no município.
                            </p>
                        </article>
                    </>
                )}

                {aba === 'estacoes' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Rede de observação</h4>
                            <span>Firebase</span>
                        </div>

                        <div className="obs-bloco">
                            <div className="obs-estado-vazio">
                                <div className="obs-icone-vazio">
                                    <span />
                                    <span />
                                    <span />
                                </div>

                                <h4>Estações no território</h4>

                                <p>
                                    As estações CUIDAÍ localizadas em
                                    {` ${municipio}`} serão exibidas aqui,
                                    com disponibilidade, temperatura,
                                    umidade e horário da última leitura.
                                </p>
                            </div>
                        </div>
                    </>
                )}

                {aba === 'historico' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Evolução meteorológica</h4>
                            <span>Séries temporais</span>
                        </div>

                        <article className="obs-bloco">
                            <div className="obs-grafico-vazio">
                                <div className="obs-grafico-grade">
                                    <span />
                                    <span />
                                    <span />
                                    <span />
                                </div>

                                <div className="obs-grafico-mensagem">
                                    Selecione uma estação com histórico
                                    disponível para visualizar as medições.
                                </div>
                            </div>

                            <p>
                                Os gráficos utilizarão leituras reais
                                armazenadas no Firebase, respeitando
                                os períodos disponíveis.
                            </p>
                        </article>
                    </>
                )}

                {aba === 'comparar' && (
                    <>
                        <div className="obs-secao-titulo">
                            <h4>Comparação territorial</h4>
                            <span>Dois municípios</span>
                        </div>

                        <div className="obs-comparacao">
                            <div className="obs-comparacao-local">
                                <span className="obs-ponto-azul" />
                                <small>Município A</small>
                                <strong>{municipio}</strong>
                            </div>

                            <div className="obs-comparacao-local">
                                <span className="obs-ponto-laranja" />
                                <small>Município B</small>
                                <strong>A selecionar</strong>
                            </div>
                        </div>

                        <article className="obs-bloco">
                            <h4>Compare dois territórios</h4>

                            <p>
                                Nesta área aparecerão as diferenças
                                de temperatura, umidade e vento entre
                                dois municípios, utilizando dados
                                referentes a horários compatíveis.
                            </p>

                            <p>
                                A seleção do segundo município será
                                conectada ao Atlas na próxima etapa.
                            </p>
                        </article>
                    </>
                )}
            </div>

            <footer className="obs-rodape">
                <strong>Fontes e metodologia</strong>
                <p>
                    Estimativas meteorológicas da Open-Meteo
                    e observações das estações CUIDAÍ serão
                    identificadas separadamente, com seus
                    respectivos horários de referência.
                </p>
            </footer>

        </section>
    );
}
