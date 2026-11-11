// Each brand's look: paint colours and number of cars. Brands are as named in Trafikverket's timetable
// (ProductInformation). Trains with no brand (freight, service) or a brand not listed get the generic look.
//
// The colours are filled in from the brand research (PLAN.md, step 5); until then every brand is generic.

const GENERIC = { colours: { body: '#c9d1d9', skirt: '#57606a', nose: '#c9d1d9' }, cars: 3 };

export const BRANDS = {};

export function styleFor(brand) {
  return BRANDS[brand] ?? GENERIC;
}
