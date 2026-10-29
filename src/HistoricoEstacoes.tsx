
import { useEffect, useState } from 'react';
import {
    collection,
    limit,
    onSnapshot,
    orderBy,
    query
} from 'firebase/firestore';
import {
    CartesianGrid,
    Line,
    LineChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis
} from 'recharts';

import { db } from './firebase';
import type { EstacaoPublica } from './estacoesMunicipais';

type Leitura = {
    id: string;
    temperatura: number;
    umidade: number;
    recebidoEm: number;
    momento: string;
};

type Props = {
    estacoes: EstacaoPublica[];
    idEstacaoSelecionada: string | null;
};

export default function HistoricoEstacoes({
    estacoes,
    idEstacaoSelecionada
}: Props) {
    const [idEscolhido, setIdEscolhido] =
        useState<string | null>(null);

    const estacao =
        estacoes.find(e => e.id === idEscolhido) ??
        estacoes.find(e => e.id === idEstacaoSelecionada) ??
        estacoes[0] ??
        null;

    const idConsulta = estacao?.id ?? null;

    const [leituras, setLeituras] = useState<Leitura[]>([]);
    const [carregando, setCarregando] = useState(false);
    const [erro, setErro] = useState<string | null>(null);

    useEffect(() => {
        setLeituras([]);
        setErro(null);

        if (!idConsulta) {
            setCarregando(false);
            return;
        }

        setCarregando(true);

        const consulta = query(
            collection(
                db,
                'estacoesMeteorologicas',
                idConsulta,
                'leituras'
            ),
            orderBy('recebidoEm', 'desc'),
            limit(72)
        );

        const unsubscribe = onSnapshot(
            consulta,
            snapshot => {
                const lista: Leitura[] = [];

                snapshot.forEach(documento => {
                    const dados = documento.data();

                    const recebidoEm =
                        typeof dados.recebidoEm?.toMillis === 'function'
                            ? dados.recebidoEm.toMillis()
                            : dados.recebidoEm;

                    if (
                        typeof dados.temperatura !== 'number' ||
                        !Number.isFinite(dados.temperatura) ||
                        dados.temperatura < -50 ||
                        dados.temperatura > 70 ||
                        typeof dados.umidade !== 'number' ||
                        !Number.isFinite(dados.umidade) ||
                        dados.umidade < 0 ||
                        dados.umidade > 100 ||
                        typeof recebidoEm !== 'number' ||
                        !Number.isFinite(recebidoEm) ||
                        recebidoEm <= 0 ||
                        recebidoEm > Date.now() + 300000
                    ) {
                        return;
                    }

                    lista.push({
                        id: documento.id,
                        temperatura: dados.temperatura,
                        umidade: dados.umidade,
                        recebidoEm,
                        momento: new Date(recebidoEm).toLocaleString(
                            'pt-BR',
                            {
                                day: '2-digit',
                                month: '2-digit',
                                hour: '2-digit',
                                minute: '2-digit'
                            }
                        )
                    });
                });

                lista.sort(
                    (a, b) => a.recebidoEm - b.recebidoEm
                );

                setLeituras(lista);
                setCarregando(false);
                setErro(null);
            },
            erroConsulta => {
                console.error(
                    'Erro ao consultar histórico:',
                    erroConsulta
                );
                setErro(
                    'Não foi possível consultar o histórico.'
                );
                setCarregando(false);
            }
        );

        return () => unsubscribe();
    }, [idConsulta]);

    if (estacoes.length === 0) {
        return (
            <article className="obs-bloco">
                <h4>Histórico indisponível</h4>
                <p>
                    Não existem estações publicadas
                    localizadas neste município.
                </p>
            </article>
        );
    }

    return (
        <div>
            <article className="obs-bloco">
                <h4>Estação meteorológica</h4>

                <select
                    aria-label="Selecionar estação para o histórico"
                    value={estacao?.id ?? ''}
                    onChange={evento =>
                        setIdEscolhido(evento.target.value)
                    }
                    style={{
                        width: '100%',
                        marginTop: 12,
                        padding: 12,
                        border: '1px solid #DCE8F3',
                        borderRadius: 10,
                        background: '#F5F9FD',
                        color: '#192942',
                        font: 'inherit'
                    }}
                >
                    {estacoes.map(item => (
                        <option key={item.id} value={item.id}>
                            {item.nome}
                        </option>
                    ))}
                </select>

                <p style={{
                    fontSize: 12,
                    color: '#8190A2'
                }}>
                    Últimas 72 medições armazenadas,
                    conforme a disponibilidade do Firebase.
                </p>
            </article>

            {carregando && (
                <article className="obs-bloco">
                    <p>Consultando histórico da estação...</p>
                </article>
            )}

            {erro && (
                <article className="obs-bloco">
                    <p role="alert">{erro}</p>
                </article>
            )}

            {!carregando && !erro && leituras.length === 0 && (
                <article className="obs-bloco">
                    <h4>Sem medições históricas</h4>
                    <p>
                        A estação ainda não possui
                        leituras válidas disponíveis.
                    </p>
                </article>
            )}

            {!carregando && !erro && leituras.length > 0 && (
                <>
                    <article className="obs-bloco">
                        <strong>
                            {leituras.length} medições disponíveis
                        </strong>

                        <p style={{
                            fontSize: 12,
                            color: '#8190A2'
                        }}>
                            De{' '}
                            {new Date(
                                leituras[0].recebidoEm
                            ).toLocaleString('pt-BR')}
                            {' até '}
                            {new Date(
                                leituras[leituras.length - 1]
                                    .recebidoEm
                            ).toLocaleString('pt-BR')}
                        </p>
                    </article>

                    {leituras.length >= 2 ? (
                        ([
                            {
                                campo: 'temperatura',
                                titulo: 'Evolução da temperatura',
                                unidade: '°C',
                                cor: '#168FC4'
                            },
                            {
                                campo: 'umidade',
                                titulo: 'Evolução da umidade',
                                unidade: '%',
                                cor: '#E98645'
                            }
                        ] as const).map(grafico => (
                            <article
                                className="obs-bloco"
                                key={grafico.campo}
                            >
                                <h4>{grafico.titulo}</h4>

                                <div style={{
                                    width: '100%',
                                    height: 240,
                                    marginTop: 18
                                }}>
                                    <ResponsiveContainer
                                        width="100%"
                                        height="100%"
                                    >
                                        <LineChart
                                            data={leituras}
                                            margin={{
                                                top: 8,
                                                right: 12,
                                                left: -20,
                                                bottom: 8
                                            }}
                                        >
                                            <CartesianGrid
                                                stroke="#E6EDF5"
                                                strokeDasharray="3 3"
                                            />

                                            <XAxis
                                                dataKey="momento"
                                                minTickGap={28}
                                                tick={{
                                                    fontSize: 10
                                                }}
                                            />

                                            <YAxis
                                                domain={['auto', 'auto']}
                                                tick={{
                                                    fontSize: 11
                                                }}
                                            />

                                            <Tooltip
                                                formatter={valor =>
                                                    `${Number(valor)
                                                        .toFixed(1)
                                                        .replace('.', ',')} ${grafico.unidade}`
                                                }
                                            />

                                            <Line
                                                type="monotone"
                                                dataKey={grafico.campo}
                                                name={grafico.titulo}
                                                stroke={grafico.cor}
                                                strokeWidth={2.5}
                                                dot={
                                                    leituras.length <= 12
                                                }
                                                isAnimationActive={false}
                                            />
                                        </LineChart>
                                    </ResponsiveContainer>
                                </div>
                            </article>
                        ))
                    ) : (
                        <article className="obs-bloco">
                            <p>
                                Há apenas uma medição válida.
                                São necessárias pelo menos duas
                                para desenhar a evolução temporal.
                            </p>
                        </article>
                    )}

                    <p style={{
                        fontSize: 11,
                        lineHeight: 1.7,
                        color: '#8190A2'
                    }}>
                        Fonte: estação CUIDAÍ.
                        Os gráficos representam medições
                        registradas, não estimativas da Open-Meteo.
                        A cobertura temporal depende das
                        leituras efetivamente disponíveis.
                    </p>
                </>
            )}
        </div>
    );
}
