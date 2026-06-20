// city-data.js — canonical real-market city facts for the SEO local-content
// builders. Facts only (county/parish, real neighborhoods, nearby areas, a true
// local appliance angle, and the most common local issue). Extend this list to
// roll deeper local content + FAQs to more cities.
'use strict';

module.exports = {
  'nashville': {
    region: 'Davidson County, TN',
    hoods: ['East Nashville', 'Germantown', 'The Nations', 'Green Hills', 'Donelson', 'Madison', 'Inglewood', 'Sylvan Park', 'Bellevue'],
    near: ['Antioch', 'Hermitage', 'Berry Hill', 'Goodlettsville'],
    commonIssue: 'a wide age range of units — from decades-old dryers to first-year smart appliances still under manufacturer warranty',
  },
  'antioch': {
    region: 'southeast Nashville (Davidson County), TN 37013',
    hoods: ['Cane Ridge', 'Priest Lake', 'Hickory Hollow', 'Nippers Corner', 'Una'],
    near: ['Nashville', 'La Vergne', 'Smyrna', 'Brentwood'],
    commonIssue: 'repeat failures on builder-grade Whirlpool and Frigidaire units across the newer subdivisions',
  },
  'murfreesboro': {
    region: 'Rutherford County, TN',
    hoods: ['Blackman', 'Siegel', 'Gateway', 'Cason Lane', 'Three Rivers'],
    near: ['Smyrna', 'La Vergne', 'Christiana', 'Eagleville'],
    commonIssue: 'warranty-age failures on new-construction appliances',
  },
  'franklin': {
    region: 'Williamson County, TN',
    hoods: ['Westhaven', 'Cool Springs', 'Berry Farms', 'Downtown Franklin', 'Fieldstone Farms'],
    near: ['Brentwood', 'Spring Hill', 'Nolensville', 'Thompson’s Station'],
    commonIssue: 'sealed-system and control-board issues on high-end built-ins like Sub-Zero, Wolf, Viking, Thermador and Bosch',
    brands: 'all major brands plus high-end built-ins — Sub-Zero, Wolf, Viking, Thermador, Bosch, Miele',
  },
  'brentwood': {
    region: 'Williamson County, TN',
    hoods: ['Governors Club', 'Annandale', 'Raintree Forest', 'Taramore'],
    near: ['Franklin', 'Nashville', 'Nolensville'],
    commonIssue: 'premium built-in appliance failures where a misdiagnosis gets expensive fast',
    brands: 'all major brands plus high-end built-ins — Sub-Zero, Wolf, Viking, Thermador, Bosch',
  },
  'hendersonville': {
    region: 'Sumner County, TN',
    hoods: ['Indian Lake', 'Walton Ferry', 'Sanders Ferry'],
    near: ['Gallatin', 'Goodlettsville', 'Old Hickory'],
    commonIssue: 'a wide mix of brands across lake homes and full-time residences',
  },
  'clarksville': {
    region: 'Montgomery County, TN',
    hoods: ['Sango', 'St. Bethlehem', 'Woodlawn', 'Exit 4'],
    near: ['Fort Campbell', 'Oak Grove, KY', 'Pleasant View'],
    commonIssue: 'fast-turnaround diagnoses for Fort Campbell PCS moves and rental turnover',
  },
  'baton-rouge': {
    region: 'East Baton Rouge Parish, LA',
    hoods: ['Mid City', 'Garden District', 'Shenandoah', 'Highland', 'Sherwood Forest'],
    near: ['Baker', 'Zachary', 'Prairieville', 'Denham Springs'],
    commonIssue: 'storm-surge control-board damage and humidity strain on refrigerators and freezers',
  },
  'new-orleans': {
    region: 'Orleans Parish, LA',
    hoods: ['Uptown', 'Mid-City', 'Lakeview', 'Gentilly', 'Algiers', 'Marigny'],
    near: ['Metairie', 'Kenner', 'Chalmette', 'Gretna'],
    commonIssue: 'humidity-related seal and gasket failures plus storm-surge board damage',
  },
  'metairie': {
    region: 'Jefferson Parish, LA',
    hoods: ['Old Metairie', 'Bucktown', 'Fat City'],
    near: ['Kenner', 'New Orleans', 'Harahan'],
    commonIssue: 'dryer vent and refrigerator seal issues driven by Gulf humidity',
  },
  'kenner': {
    region: 'Jefferson Parish, LA',
    hoods: ['Chateau Estates', 'University City', 'Driftwood'],
    near: ['Metairie', 'Harahan', 'New Orleans'],
    commonIssue: 'humidity wear on dryers and refrigerator seals',
  },
  'hammond': {
    region: 'Tangipahoa Parish, LA',
    hoods: ['University area (SLU)', 'North Oaks area', 'Downtown Hammond'],
    near: ['Ponchatoula', 'Albany', 'Independence'],
    commonIssue: 'surge-damaged control boards from frequent Northshore power flickers',
  },
  'covington': {
    region: 'St. Tammany Parish, LA',
    hoods: ['Downtown Covington', 'River Forest', 'Tchefuncte'],
    near: ['Mandeville', 'Madisonville', 'Abita Springs'],
    commonIssue: 'the full brand range across historic downtown and new Tchefuncte builds',
  },
  'slidell': {
    region: 'St. Tammany Parish, LA',
    hoods: ['Olde Towne', 'Eden Isles', 'Lakeshore Estates'],
    near: ['Pearl River', 'Lacombe', 'New Orleans East'],
    commonIssue: 'post-storm control-board and moisture damage',
  },
  'denham-springs': {
    region: 'Livingston Parish, LA',
    hoods: ['Watson', 'Walker area', 'Juban Crossing'],
    near: ['Walker', 'Baton Rouge', 'Livingston'],
    commonIssue: 'post-2016-flood replacement appliances now hitting their failure window together',
  },
};
