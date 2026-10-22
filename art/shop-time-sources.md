# Indianapolis clock and daylight calculations

The shop uses `America/Indiana/Indianapolis` through the browser's IANA timezone
data, so its date and clock follow Eastern Standard/Daylight Time independently
of the visitor's timezone. Closing is 20:00 local; the closing warning starts at
19:59. No morning opening hour was supplied, so 09:00 is an implementation
default, not an author-specified hour. `sessionDay` retains the previous local
calendar date before that opening time, keeping overnight story state together.

Daylight is calculated locally for Indianapolis, Indiana (39.7684° N,
86.1581° W). No API call or permission is needed at runtime. Solar declination
and equation of time use NOAA's documented Meeus equations, evaluated iteratively
at each event. Sunrise/sunset use a geometric solar center altitude of -0.833°
(standard solar disk/refraction allowance). Dawn/dusk use -6° civil twilight.
Terrain and actual atmospheric conditions can shift observed sunrise/sunset.

Primary references consulted October 22, 2026:

- [NOAA calculation details](https://gml.noaa.gov/grad/solcalc/calcdetails.html)
- [NOAA solar calculation equations](https://gml.noaa.gov/grad/solcalc/solareqns.PDF)
- [NOAA implementation of the Meeus equations](https://gml.noaa.gov/grad/solcalc/main.js)
- [US Naval Observatory API documentation](https://aa.usno.navy.mil/data/api.html)

Independent regression fixtures from USNO (the service reports rounded minutes):

| Indianapolis date | UTC offset | Civil dawn | Sunrise | Sunset | Civil dusk |
| --- | --- | --- | --- | --- | --- |
| 2026-06-21 | -04:00 | 05:44 | 06:17 | 21:16 | 21:49 |
| 2026-12-21 | -05:00 | 07:32 | 08:02 | 17:23 | 17:54 |

- [Summer USNO response](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-06-21&coords=39.7684,-86.1581&tz=-4)
- [Winter USNO response](https://aa.usno.navy.mil/api/rstt/oneday?date=2026-12-21&coords=39.7684,-86.1581&tz=-5)

`solarLight` returns geometric altitude in radians and three smooth weights
whose sum is one. Night fades to civil twilight between -6° and -0.833°;
twilight fades to full daylight between -0.833° and +8°. The app can use these
weights to blend its sky, ambient light, windows and street lamps without jumps.
