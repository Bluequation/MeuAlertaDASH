import { RESERVATORIO_PILOTO } from './aguaDados';

export type RespostaOpenMeteo = {
  current?: {
    time: string;
    temperature_2m: number;
    relative_humidity_2m: number;
    apparent_temperature: number;
    precipitation: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    pressure_msl: number;
  };
  hourly?: {
    time: string[];
    temperature_2m: Array<number | null>;
    relative_humidity_2m: Array<number | null>;
    wind_speed_10m: Array<number | null>;
    precipitation: Array<number | null>;
    shortwave_radiation: Array<number | null>;
  };
  daily?: {
    time: string[];
    precipitation_sum: Array<number | null>;
    temperature_2m_max: Array<number | null>;
    temperature_2m_min: Array<number | null>;
  };
  timezone?: string;
  timezone_abbreviation?: string;
};

export async function consultarMeteorologiaReservatorio(
  sinal?: AbortSignal
): Promise<RespostaOpenMeteo> {
  const parametros = new URLSearchParams({
    latitude: String(RESERVATORIO_PILOTO.latitude),
    longitude: String(RESERVATORIO_PILOTO.longitude),
    current: [
      'temperature_2m',
      'relative_humidity_2m',
      'apparent_temperature',
      'precipitation',
      'wind_speed_10m',
      'wind_direction_10m',
      'pressure_msl'
    ].join(','),
    hourly: [
      'temperature_2m',
      'relative_humidity_2m',
      'wind_speed_10m',
      'precipitation',
      'shortwave_radiation'
    ].join(','),
    daily: [
      'precipitation_sum',
      'temperature_2m_max',
      'temperature_2m_min'
    ].join(','),
    past_days: '7',
    forecast_days: '7',
    timezone: 'America/Fortaleza',
    temperature_unit: 'celsius',
    wind_speed_unit: 'ms',
    precipitation_unit: 'mm'
  });

  const resposta = await fetch(
    'https://api.open-meteo.com/v1/forecast?' + parametros.toString(),
    { signal: sinal }
  );

  if (!resposta.ok) {
    throw new Error('Não foi possível consultar a meteorologia (HTTP ' + resposta.status + ').');
  }

  const dados = await resposta.json() as RespostaOpenMeteo;

  if (!dados.current || !dados.hourly) {
    throw new Error('A resposta meteorológica não trouxe as variáveis esperadas.');
  }

  return dados;
}
