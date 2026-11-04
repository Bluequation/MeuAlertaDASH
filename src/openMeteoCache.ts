// Cache compartilhado das consultas Open-Meteo.
// Os dados permanecem por 15 minutos na memória da aba.

const CACHE_MS = 15 * 60 * 1000;
const PAUSA_429_MS = 15 * 60 * 1000;
const MAX_ENTRADAS = 80;

type EntradaCache = {
    dados: unknown;
    expiraEm: number;
};

const cache = new Map<string, EntradaCache>();
const pendentes = new Map<string, Promise<unknown>>();

let bloqueadoAte = 0;

// Permite cancelar a espera de um componente
// sem cancelar uma consulta compartilhada.
function comCancelamento<T>(
    promessa: Promise<T>,
    signal: AbortSignal
): Promise<T> {
    if (signal.aborted) {
        return Promise.reject(
            new DOMException('Consulta cancelada', 'AbortError')
        );
    }

    return new Promise<T>((resolve, reject) => {
        const abortar = () => {
            reject(
                new DOMException('Consulta cancelada', 'AbortError')
            );
        };

        signal.addEventListener('abort', abortar, { once: true });

        promessa.then(
            resultado => {
                signal.removeEventListener('abort', abortar);
                resolve(resultado);
            },
            erro => {
                signal.removeEventListener('abort', abortar);
                reject(erro);
            }
        );
    });
}

// Respeita Retry-After quando a API informar
// por quanto tempo devemos aguardar.
function duracaoBloqueio(resposta: Response): number {
    const cabecalho = resposta.headers.get('Retry-After');

    if (!cabecalho) return PAUSA_429_MS;

    const segundos = Number(cabecalho);

    if (Number.isFinite(segundos) && segundos >= 0) {
        return Math.max(60_000, segundos * 1000);
    }

    const data = Date.parse(cabecalho);

    return Number.isFinite(data)
        ? Math.max(60_000, data - Date.now())
        : PAUSA_429_MS;
}

export function consultarOpenMeteoComCache(
    url: string,
    signal: AbortSignal
): Promise<unknown> {
    if (signal.aborted) {
        return Promise.reject(
            new DOMException('Consulta cancelada', 'AbortError')
        );
    }

    const agora = Date.now();
    const existente = cache.get(url);

    // Reutiliza dados recentes.
    if (existente && existente.expiraEm > agora) {
        return comCancelamento(
            Promise.resolve(existente.dados),
            signal
        );
    }

    if (existente) cache.delete(url);

    // Compartilha requisições idênticas em andamento.
    let tarefa = pendentes.get(url);

    if (!tarefa) {
        // Não repete consultas durante o bloqueio.
        if (agora < bloqueadoAte) {
            return Promise.reject(
                new Error(
                    'Open-Meteo: HTTP 429. Limite temporário de consultas.'
                )
            );
        }

        tarefa = (async (): Promise<unknown> => {
            const resposta = await fetch(url);

            if (!resposta.ok) {
                if (resposta.status === 429) {
                    bloqueadoAte = Math.max(
                        bloqueadoAte,
                        Date.now() + duracaoBloqueio(resposta)
                    );
                }

                throw new Error(
                    `Open-Meteo: HTTP ${resposta.status}`
                );
            }

            const dados: unknown = await resposta.json();

            cache.set(url, {
                dados,
                expiraEm: Date.now() + CACHE_MS
            });

            // Limita o uso de memória.
            if (cache.size > MAX_ENTRADAS) {
                const primeira = cache.keys().next().value;

                if (primeira !== undefined) {
                    cache.delete(primeira);
                }
            }

            return dados;
        })();

        pendentes.set(url, tarefa);

        // Limpa tanto no sucesso quanto na falha.
        void tarefa.then(
            () => { pendentes.delete(url); },
            () => { pendentes.delete(url); }
        );
    }

    return comCancelamento(tarefa, signal);
}