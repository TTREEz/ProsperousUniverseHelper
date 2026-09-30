import { useEffect, useId, useState } from "react";
import { cn } from "@/components/ui";
import { prosperousProvider } from "@/provider/fio-provider";

/**
 * A text box that also offers a list to pick from.
 *
 * Deliberately not a closed dropdown: tickers are short and someone who knows
 * the one they want should be able to type it without hunting a list, while
 * someone who does not gets the options. A value that is not in the list is
 * still accepted, because the list can be incomplete — a planet may trade
 * something it does not yet produce.
 */
export type ComboOption = { value: string; label?: string };

export function ComboInput({
  value,
  onChange,
  options,
  placeholder,
  className,
  onKeyDown,
}: {
  value: string;
  onChange: (next: string) => void;
  options: ComboOption[];
  placeholder?: string;
  className?: string;
  onKeyDown?: (event: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
  const listId = useId();

  return (
    <>
      <input
        list={listId}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        className={cn("field", className)}
      />
      <datalist id={listId}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </datalist>
    </>
  );
}

let materialsPromise: Promise<ComboOption[]> | null = null;
let buildingsPromise: Promise<ComboOption[]> | null = null;

/**
 * Every material and building ticker, fetched once per session. The provider
 * caches the responses, so this only turns them into option lists.
 */
export function useCatalog(kind: "materials" | "buildings"): ComboOption[] {
  const [options, setOptions] = useState<ComboOption[]>([]);

  useEffect(() => {
    let cancelled = false;

    if (kind === "materials") {
      materialsPromise ??= prosperousProvider
        .getAllMaterials()
        .then((materials) =>
          materials
            .filter((material) => material.ticker)
            .map((material) => ({ value: material.ticker, label: material.name ?? undefined }))
            .sort((a, b) => a.value.localeCompare(b.value)),
        )
        .catch(() => []);
    } else {
      buildingsPromise ??= prosperousProvider
        .getAllBuildings()
        .then((buildings) =>
          buildings
            .filter((building) => building.code)
            .map((building) => ({ value: building.code, label: building.name ?? undefined }))
            .sort((a, b) => a.value.localeCompare(b.value)),
        )
        .catch(() => []);
    }

    void (kind === "materials" ? materialsPromise : buildingsPromise)?.then((result) => {
      if (!cancelled) setOptions(result);
    });

    return () => {
      cancelled = true;
    };
  }, [kind]);

  return options;
}
