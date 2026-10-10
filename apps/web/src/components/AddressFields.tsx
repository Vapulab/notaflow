import { useEffect, useRef, useState } from 'react';
import { api, type CepAnswer, type Country, type Municipality, type PartyAddress } from '../api';
import { Alert, Combobox, type ComboboxOption, Field, Input } from '../ui';
import { errorText } from './Layout';

export interface AddressValue {
  kind: 'domestic' | 'foreign';
  municipality: Municipality | null; // domestic
  zip: string; // domestic, digits only
  country: Country | null; // foreign
  postalCode: string;
  city: string;
  region: string;
  street: string;
  number: string;
  complement: string;
  district: string;
}

type TextField = 'postalCode' | 'city' | 'region' | 'street' | 'number' | 'complement' | 'district';

export function emptyAddress(kind: AddressValue['kind']): AddressValue {
  return {
    kind,
    municipality: null,
    zip: '',
    country: null,
    postalCode: '',
    city: '',
    region: '',
    street: '',
    number: '',
    complement: '',
    district: '',
  };
}

// A saved address has only the codes; AddressFields looks the names up.
export function addressFromParty(
  address: PartyAddress | null,
  kind: AddressValue['kind'],
): AddressValue {
  if (!address) return emptyAddress(kind);
  return {
    kind: address.kind,
    municipality: address.municipality ? { code: address.municipality, name: '', uf: '' } : null,
    zip: address.zip ?? '',
    country: address.country ? { code: address.country, name: '' } : null,
    postalCode: address.postalCode ?? '',
    city: address.city ?? '',
    region: address.region ?? '',
    street: address.street,
    number: address.number,
    complement: address.complement ?? '',
    district: address.district,
  };
}

const REQUIRED_TEXT: Record<AddressValue['kind'], TextField[]> = {
  domestic: ['street', 'number', 'district'],
  foreign: ['postalCode', 'city', 'region', 'street', 'number', 'district'],
};

export function toPartyAddress(value: AddressValue): PartyAddress | null {
  if (REQUIRED_TEXT[value.kind].some((field) => value[field].trim() === '')) return null;
  const common = {
    street: value.street.trim(),
    number: value.number.trim(),
    ...(value.complement.trim() ? { complement: value.complement.trim() } : {}),
    district: value.district.trim(),
  };
  if (value.kind === 'domestic') {
    if (!value.municipality || value.zip.length !== 8) return null;
    return { kind: 'domestic', municipality: value.municipality.code, zip: value.zip, ...common };
  }
  if (!value.country) return null;
  return {
    kind: 'foreign',
    country: value.country.code,
    postalCode: value.postalCode.trim(),
    city: value.city.trim(),
    region: value.region.trim(),
    ...common,
  };
}

const municipalityOption = (m: Municipality): ComboboxOption => ({
  value: m.code,
  label: `${m.name} - ${m.uf}`,
});
const countryOption = (c: Country): ComboboxOption => ({
  value: c.code,
  label: `${c.name} (${c.code})`,
});

// Search results for a combobox, asked 300 ms after the last key.
function useSearch<T>(url: string, query: string): T[] {
  const [found, setFound] = useState<T[]>([]);
  useEffect(() => {
    const text = query.trim();
    if (!text) return;
    let live = true;
    const timer = setTimeout(() => {
      api.get<T[]>(`${url}?q=${encodeURIComponent(text)}`).then(
        (items) => {
          if (live) setFound(items);
        },
        () => {
          if (live) setFound([]);
        },
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [url, query]);
  return query.trim() ? found : [];
}

export function AddressFields(props: {
  accountId: string;
  value: AddressValue;
  onChange: (value: AddressValue) => void;
}) {
  const { value, onChange } = props;
  const base = `/api/accounts/${encodeURIComponent(props.accountId)}`;
  const [municipalityQuery, setMunicipalityQuery] = useState('');
  const [countryQuery, setCountryQuery] = useState('');
  const [cepMessage, setCepMessage] = useState<string | null>(null);
  const municipalities = useSearch<Municipality>(`${base}/municipalities`, municipalityQuery);
  const countries = useSearch<Country>(`${base}/countries`, countryQuery);
  const latest = useRef(value);
  latest.current = value;

  // A saved address has only codes: look up the names once.
  const municipalityCode =
    value.municipality && !value.municipality.name ? value.municipality.code : null;
  const countryCode = value.country && !value.country.name ? value.country.code : null;
  useEffect(() => {
    if (!municipalityCode) return;
    void api.get<Municipality[]>(`${base}/municipalities?q=${municipalityCode}`).then((found) => {
      const place = found[0];
      if (place && latest.current.municipality?.code === place.code) {
        onChange({ ...latest.current, municipality: place });
      }
    });
  }, [base, municipalityCode, onChange]);
  useEffect(() => {
    if (!countryCode) return;
    void api.get<Country[]>(`${base}/countries?q=${countryCode}`).then((found) => {
      const place = found[0];
      if (place && latest.current.country?.code === place.code) {
        onChange({ ...latest.current, country: place });
      }
    });
  }, [base, countryCode, onChange]);

  const set = (patch: Partial<AddressValue>) => onChange({ ...latest.current, ...patch });

  async function lookUpCep() {
    const zip = latest.current.zip;
    if (zip.length !== 8) return;
    const before = latest.current;
    setCepMessage(null);
    try {
      const found = await api.get<CepAnswer>(`${base}/cep/${zip}`);
      const now = latest.current;
      // Never overwrite what the user typed while the lookup ran.
      onChange({
        ...now,
        street: now.street === before.street ? found.street || now.street : now.street,
        district: now.district === before.district ? found.district || now.district : now.district,
        municipality:
          now.municipality === before.municipality ? found.municipality : now.municipality,
      });
    } catch (error) {
      setCepMessage(errorText(error));
    }
  }

  const text = (field: TextField, label: string) => (
    <Field label={label}>
      <Input value={value[field]} onChange={(e) => set({ [field]: e.target.value })} />
    </Field>
  );

  return (
    <div className="flex flex-col gap-4">
      {value.kind === 'domestic' ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="CEP">
            <Input
              inputMode="numeric"
              value={value.zip}
              onChange={(e) => set({ zip: e.target.value.replace(/\D/g, '').slice(0, 8) })}
              onBlur={() => void lookUpCep()}
            />
          </Field>
          <Field label="Município">
            <Combobox
              label="Município"
              query={municipalityQuery}
              onQueryChange={setMunicipalityQuery}
              options={municipalities.map(municipalityOption)}
              selected={value.municipality?.name ? municipalityOption(value.municipality) : null}
              onSelect={(option) =>
                set({
                  municipality: option
                    ? (municipalities.find((m) => m.code === option.value) ?? null)
                    : null,
                })
              }
              placeholder="Digite o nome do município"
            />
          </Field>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="País">
            <Combobox
              label="País"
              query={countryQuery}
              onQueryChange={setCountryQuery}
              options={countries.map(countryOption)}
              selected={value.country?.name ? countryOption(value.country) : null}
              onSelect={(option) =>
                set({
                  country: option ? (countries.find((c) => c.code === option.value) ?? null) : null,
                })
              }
              placeholder="Digite o nome do país"
            />
          </Field>
          {text('postalCode', 'Código postal')}
          {text('city', 'Cidade')}
          {text('region', 'Estado ou região')}
        </div>
      )}
      {cepMessage && <Alert variant="warning">{cepMessage}</Alert>}
      <div className="grid gap-4 sm:grid-cols-2">
        {text('street', 'Logradouro')}
        {text('number', 'Número')}
        {text('complement', 'Complemento')}
        {text('district', 'Bairro')}
      </div>
    </div>
  );
}
