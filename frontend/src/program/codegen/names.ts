/**
 * C identifier allocation: sanitizes user names and avoids collisions with
 * C++ keywords, the Arduino API (both cores) and the generated helpers.
 */

const RESERVED_LIST = `
alignas alignof and asm auto bool break case catch char char16_t char32_t class const constexpr const_cast
continue decltype default delete do double dynamic_cast else enum explicit export extern false float for
friend goto if inline int long mutable namespace new noexcept not nullptr operator or private protected
public register reinterpret_cast return short signed sizeof static static_assert static_cast struct switch
template this thread_local throw true try typedef typeid typename union unsigned using virtual void volatile
wchar_t while xor
setup loop main pinMode digitalWrite digitalRead analogWrite analogRead analogReference analogReadResolution
analogWriteResolution delay delayMicroseconds millis micros tone noTone pulseIn pulseInLong shiftIn shiftOut
attachInterrupt detachInterrupt interrupts noInterrupts map constrain min max abs round sqrt sq pow sin cos tan
asin acos atan atan2 exp log log10 floor ceil fabs fmod trunc isnan isinf radians degrees random randomSeed
bit bitRead bitWrite bitSet bitClear lowByte highByte yield Serial Serial1 Serial2 Wire SPI String boolean
byte word size_t uint8_t uint16_t uint32_t uint64_t int8_t int16_t int32_t int64_t HIGH LOW INPUT OUTPUT
INPUT_PULLUP INPUT_PULLDOWN OPEN_DRAIN LED_BUILTIN RGB_BUILTIN RGB_BRIGHTNESS BUILTIN_LED PIN_RGB_LED LSBFIRST
MSBFIRST CHANGE RISING FALLING PI HALF_PI TWO_PI DEG_TO_RAD RAD_TO_DEG EULER SERIAL DISPLAY DEC HEX OCT BIN F
A0 A1 A2 A3 A4 A5 A6 A7 SDA SCL SS MOSI MISO SCK TX RX NUM_DIGITAL_PINS NUM_ANALOG_INPUTS MIN MAX Servo
rgbLedWrite neopixelWrite PORTB PORTC PORTD DDRB DDRC DDRD PINB PINC PIND SREG TCCR0A TCCR0B TCCR1A TCCR1B
TCCR2A TCCR2B OCR0A OCR0B OCR1A OCR1B OCR2A OCR2B TIMSK0 TIMSK1 TIMSK2 TCNT0 TCNT1 TCNT2 ADC ADCSRA ADMUX
UDR0 EEPROM NULL
cv_div cv_mod cv_map cv_pwm cv_percentToPwm cv_percent cv_ms cv_constrain cv_tone cvPrint cvPrintln
`;

/**
 * C library symbols declared by the headers both cores pull in (avr-libc,
 * newlib + POSIX on the ESP32): a global `double time` or `bool index` is a
 * compile error ("redeclared as different kind of entity"). Also object- and
 * function-like macros (DEFAULT, EOF, NAN, assert, offsetof…) and core
 * objects (ESP, Serial0…). Verified against arduino-cli (avr 1.8 / esp32 3.3).
 */
const LIBC_LIST = `
abort exit _exit atexit quick_exit system getenv setenv unsetenv putenv free malloc calloc realloc aligned_alloc
abs labs llabs div ldiv lldiv atof atoi atol atoll strtod strtof strtold strtol strtoll strtoul strtoull qsort bsearch
rand srand random srandom rand_r drand48 lrand48 mrand48 srand48 erand48 seed48 itoa ltoa utoa ultoa dtostrf dtostre
time clock difftime mktime gmtime localtime asctime ctime strftime strptime tzset timezone daylight tzname
gettimeofday settimeofday nanosleep sleep usleep alarm pause open close read write lseek select poll pipe dup dup2
fork kill signal raise sigaction link unlink rename remove access chdir rmdir mkdir getpid isatty sync truncate fsync
environ errno optarg optind opterr optopt stdin stdout stderr printf sprintf snprintf vprintf vsprintf vsnprintf
asprintf scanf sscanf fprintf fscanf puts gets putchar getchar fputs fgets fputc fgetc putc getc ungetc fopen fclose
fread fwrite fflush fseek ftell rewind feof ferror clearerr perror tmpfile tmpnam setbuf setvbuf fdopen fileno
strlen strnlen strcpy strncpy strcat strncat strcmp strncmp strchr strrchr strstr strtok strtok_r strdup strndup
strerror strspn strcspn strpbrk strsep strlcpy strlcat strcasecmp strncasecmp strcoll strxfrm memcpy memmove memset
memcmp memchr memccpy bzero bcopy bcmp ffs index rindex isalnum isalpha isascii isblank iscntrl isdigit isgraph
islower isprint ispunct isspace isupper isxdigit tolower toupper toascii acos asin atan atan2 cosh sinh tanh acosh
asinh atanh exp exp2 expm1 exp10 log2 log1p logb ilogb pow10 cbrt hypot rint lrint llrint lround llround nearbyint
remainder remquo drem modf frexp ldexp scalbn scalbln copysign nan nanf nextafter nexttoward fdim fmax fmin fma
signbit isfinite isnormal fpclassify finite gamma lgamma tgamma erf erfc j0 j1 jn y0 y1 yn significand square sincos
acosf asinf atanf atan2f cbrtf ceilf copysignf cosf coshf expf fabsf fdimf floorf fmaf fmaxf fminf fmodf frexpf
hypotf isfinitef isinff isnanf ldexpf log10f logf lrintf lroundf powf roundf signbitf sinf sinhf sqrtf squaref tanf
tanhf truncf modff assert offsetof va_list va_start va_end va_arg FILE fpos_t ssize_t time_t clock_t ptrdiff_t
wchar_t intptr_t uintptr_t div_t ldiv_t tm timeval
pulseIn shiftOut shiftIn makeWord analogReadMilliVolts analogSetAttenuation analogSetPinAttenuation ledcAttach
ledcAttachChannel ledcWrite ledcWriteTone ledcWriteNote ledcDetach ledcSetup ledcAttachPin ledcRead ledcReadFreq
touchRead temperatureRead esp_random digitalPinToInterrupt bitToggle sei cli ISR SIGNAL EMPTY_INTERRUPT PSTR PROGMEM
log_e log_w log_i log_d log_v log_n isr_log_e isr_log_w isr_log_i isr_log_d isr_log_v ESP Serial0 USBSerial
HWCDCSerial EspClass HardwareSerial Print Stream IPAddress
DEFAULT EXTERNAL INTERNAL INTERNAL1V1 INTERNAL2V56 INTERNAL2V56_EXTCAP ANALOG DISABLED PULLUP PULLDOWN ONLOW ONHIGH
ONLOW_WE ONHIGH_WE OUTPUT_OPEN_DRAIN BIT NOP F_CPU EOF BUFSIZ EXIT_SUCCESS EXIT_FAILURE RAND_MAX RANDOM_MAX INT_MAX
INT_MIN UINT_MAX LONG_MAX LONG_MIN ULONG_MAX LLONG_MAX LLONG_MIN ULLONG_MAX CHAR_BIT CHAR_MAX CHAR_MIN SCHAR_MAX
SCHAR_MIN UCHAR_MAX SHRT_MAX SHRT_MIN USHRT_MAX FLT_MAX FLT_MIN DBL_MAX DBL_MIN FLT_EPSILON DBL_EPSILON NAN INFINITY
HUGE_VAL HUGE_VALF M_PI M_E M_PI_2 M_PI_4 M_1_PI M_2_PI M_2_SQRTPI M_LN2 M_LN10 M_LOG2E M_LOG10E M_SQRT2 M_SQRT1_2
NOT_A_PIN NOT_A_PORT NOT_AN_INTERRUPT NOT_ON_TIMER BOOT_PIN FSPI HSPI VSPI PA PB PC PD PE PF PG PH PJ PK PL BUSY FAIL
OK STATUS CLOCKS_PER_SEC SEEK_SET SEEK_CUR SEEK_END ESP_OK ESP_FAIL IRAM_ATTR DRAM_ATTR portMAX_DELAY pdTRUE pdFALSE
pdPASS pdFAIL TIMER0A TIMER0B TIMER1A TIMER1B TIMER1C TIMER2 TIMER2A TIMER2B SPI_MODE0 SPI_MODE1 SPI_MODE2 SPI_MODE3
PIN_A0 PIN_A1 PIN_A2 PIN_A3 PIN_A4 PIN_A5 PIN_A6 PIN_A7 PIN_RGB_LED PIN_WIRE_SDA PIN_WIRE_SCL PIN_SPI_SS PIN_SPI_MOSI
PIN_SPI_MISO PIN_SPI_SCK LED_BUILTIN_AUX SERIAL_PORT_MONITOR SERIAL_PORT_HARDWARE EXTERNAL_NUM_INTERRUPTS
`;

/** AVR register / bit macros of the ATmega328P (avr/iom328p.h, sfr_defs, interrupt, pgmspace). */
const AVR_MACROS = `
ACBG ACD ACI ACIC ACIE ACIS0 ACIS1 ACME ACO ACSR ADATE ADC ADC0D ADC1D ADC2D ADC3D ADC4D ADC5D ADCH ADCH0 ADCH1 ADCH2
ADCH3 ADCH4 ADCH5 ADCH6 ADCH7 ADCL ADCL0 ADCL1 ADCL2 ADCL3 ADCL4 ADCL5 ADCL6 ADCL7 ADCSRA ADCSRB ADCW ADEN ADIE ADIF
ADLAR ADMUX ADPS0 ADPS1 ADPS2 ADSC ADTS0 ADTS1 ADTS2 AIN0D AIN1D AS2 ASSR AVR_EXTENDED_INDIRECT_ADDR
AVR_EXTENDED_INDIRECT_REG AVR_RAMPD_ADDR AVR_RAMPD_REG AVR_RAMPX_ADDR AVR_RAMPX_REG AVR_RAMPY_ADDR AVR_RAMPY_REG
AVR_RAMPZ_ADDR AVR_RAMPZ_REG AVR_STACK_POINTER_ADDR AVR_STACK_POINTER_HI_ADDR AVR_STACK_POINTER_HI_REG
AVR_STACK_POINTER_LO_ADDR AVR_STACK_POINTER_LO_REG AVR_STACK_POINTER_REG AVR_STATUS_ADDR AVR_STATUS_REG BLBSET BODS
BODSE BORF CAL0 CAL1 CAL2 CAL3 CAL4 CAL5 CAL6 CAL7 CANIDT CLKPCE CLKPR CLKPS0 CLKPS1 CLKPS2 CLKPS3 COM0A0 COM0A1
COM0B0 COM0B1 COM1A0 COM1A1 COM1B0 COM1B1 COM2A0 COM2A1 COM2B0 COM2B1 CPHA CPOL CS00 CS01 CS02 CS10 CS11 CS12 CS20
CS21 CS22 DDB0 DDB1 DDB2 DDB3 DDB4 DDB5 DDB6 DDB7 DDC0 DDC1 DDC2 DDC3 DDC4 DDC5 DDC6 DDD0 DDD1 DDD2 DDD3 DDD4 DDD5
DDD6 DDD7 DDRB DDRC DDRD DIDR0 DIDR1 DOR0 DORD E2END E2PAGESIZE EEAR EEAR0 EEAR1 EEAR2 EEAR3 EEAR4 EEAR5 EEAR6 EEAR7
EEAR8 EEAR9 EEARH EEARL EECR EEDR EEDR0 EEDR1 EEDR2 EEDR3 EEDR4 EEDR5 EEDR6 EEDR7 EEMPE EEMWE EEPE EEPM0 EEPM1 EERE
EERIE EEWE EFUSE_DEFAULT EICRA EIFR EIMSK EIND EMPTY_INTERRUPT EXCLK EXTRF FE0 FLASHEND FOC0A FOC0B FOC1A FOC1B FOC2A
FOC2B FUSE_BODLEVEL0 FUSE_BODLEVEL1 FUSE_BODLEVEL2 FUSE_BOOTRST FUSE_BOOTSZ0 FUSE_BOOTSZ1 FUSE_CKDIV8 FUSE_CKOUT
FUSE_CKSEL0 FUSE_CKSEL1 FUSE_CKSEL2 FUSE_CKSEL3 FUSE_DWEN FUSE_EESAVE FUSE_MEMORY_SIZE FUSE_RSTDISBL FUSE_SPIEN
FUSE_SUT0 FUSE_SUT1 FUSE_WDTON GPIOR0 GPIOR00 GPIOR01 GPIOR02 GPIOR03 GPIOR04 GPIOR05 GPIOR06 GPIOR07 GPIOR1 GPIOR10
GPIOR11 GPIOR12 GPIOR13 GPIOR14 GPIOR15 GPIOR16 GPIOR17 GPIOR2 GPIOR20 GPIOR21 GPIOR22 GPIOR23 GPIOR24 GPIOR25
GPIOR26 GPIOR27 GTCCR HFUSE_DEFAULT ICES1 ICF1 ICIE1 ICNC1 ICR1 ICR1H ICR1H0 ICR1H1 ICR1H2 ICR1H3 ICR1H4 ICR1H5
ICR1H6 ICR1H7 ICR1L ICR1L0 ICR1L1 ICR1L2 ICR1L3 ICR1L4 ICR1L5 ICR1L6 ICR1L7 INT0 INT1 INTF0 INTF1 ISC00 ISC01 ISC10
ISC11 ISR ISR_ALIAS ISR_ALIASOF ISR_BLOCK ISR_NAKED ISR_NOBLOCK IVCE IVSEL LED_BUILTIN LFUSE_DEFAULT MCUCR MCUSR
MPCM0 MSTR MUX0 MUX1 MUX2 MUX3 NUM_ANALOG_INPUTS NUM_DIGITAL_PINS OCF0A OCF0B OCF1A OCF1B OCF2A OCF2B OCIE0A OCIE0B
OCIE1A OCIE1B OCIE2A OCIE2B OCR0A OCR0A_0 OCR0A_1 OCR0A_2 OCR0A_3 OCR0A_4 OCR0A_5 OCR0A_6 OCR0A_7 OCR0B OCR0B_0
OCR0B_1 OCR0B_2 OCR0B_3 OCR0B_4 OCR0B_5 OCR0B_6 OCR0B_7 OCR1A OCR1AH OCR1AH0 OCR1AH1 OCR1AH2 OCR1AH3 OCR1AH4 OCR1AH5
OCR1AH6 OCR1AH7 OCR1AL OCR1AL0 OCR1AL1 OCR1AL2 OCR1AL3 OCR1AL4 OCR1AL5 OCR1AL6 OCR1AL7 OCR1B OCR1BH OCR1BH0 OCR1BH1
OCR1BH2 OCR1BH3 OCR1BH4 OCR1BH5 OCR1BH6 OCR1BH7 OCR1BL OCR1BL0 OCR1BL1 OCR1BL2 OCR1BL3 OCR1BL4 OCR1BL5 OCR1BL6
OCR1BL7 OCR2A OCR2AUB OCR2B OCR2BUB OCR2_0 OCR2_1 OCR2_2 OCR2_3 OCR2_4 OCR2_5 OCR2_6 OCR2_7 OSCCAL PCICR PCIE0 PCIE1
PCIE2 PCIF0 PCIF1 PCIF2 PCIFR PCINT0 PCINT1 PCINT10 PCINT11 PCINT12 PCINT13 PCINT14 PCINT16 PCINT17 PCINT18 PCINT19
PCINT2 PCINT20 PCINT21 PCINT22 PCINT23 PCINT3 PCINT4 PCINT5 PCINT6 PCINT7 PCINT8 PCINT9 PCMSK0 PCMSK1 PCMSK2 PGERS
PGM_P PGM_VOID_P PGWRT PINB PINB0 PINB1 PINB2 PINB3 PINB4 PINB5 PINB6 PINB7 PINC PINC0 PINC1 PINC2 PINC3 PINC4 PINC5
PINC6 PIND PIND0 PIND1 PIND2 PIND3 PIND4 PIND5 PIND6 PIND7 PIN_A0 PIN_A1 PIN_A2 PIN_A3 PIN_A4 PIN_A5 PIN_A6 PIN_A7
PIN_SPI_MISO PIN_SPI_MOSI PIN_SPI_SCK PIN_SPI_SS PIN_WIRE_SCL PIN_WIRE_SDA PORF PORTA PORTB PORTB0 PORTB1 PORTB2
PORTB3 PORTB4 PORTB5 PORTB6 PORTB7 PORTC PORTC0 PORTC1 PORTC2 PORTC3 PORTC4 PORTC5 PORTC6 PORTD PORTD0 PORTD1 PORTD2
PORTD3 PORTD4 PORTD5 PORTD6 PORTD7 PRADC PROGMEM PRR PRSPI PRTIM0 PRTIM1 PRTIM2 PRTWI PRUSART0 PSRASY PSRSYNC PSTR
PUD Pins_Arduino_h RAMEND RAMPZ RAMSTART REFS0 REFS1 RWWSB RWWSRE RXB80 RXC0 RXCIE0 RXEN0 SE SELFPRGEN
SERIAL_PORT_HARDWARE SERIAL_PORT_MONITOR SIGNAL SIGNATURE_0 SIGNATURE_1 SIGNATURE_2 SIGRD SLEEP_MODE_ADC
SLEEP_MODE_EXT_STANDBY SLEEP_MODE_IDLE SLEEP_MODE_PWR_DOWN SLEEP_MODE_PWR_SAVE SLEEP_MODE_STANDBY SM0 SM1 SM2 SMCR SP
SPCR SPDR SPDR0 SPDR1 SPDR2 SPDR3 SPDR4 SPDR5 SPDR6 SPDR7 SPE SPH SPI2X SPIE SPIF SPL SPMCSR SPMEN SPMIE SPM_PAGESIZE
SPR0 SPR1 SPSR SREG SREG_C SREG_H SREG_I SREG_N SREG_S SREG_T SREG_V SREG_Z TCCR0A TCCR0B TCCR1A TCCR1B TCCR1C TCCR2A
TCCR2B TCN2UB TCNT0 TCNT0_0 TCNT0_1 TCNT0_2 TCNT0_3 TCNT0_4 TCNT0_5 TCNT0_6 TCNT0_7 TCNT1 TCNT1H TCNT1H0 TCNT1H1
TCNT1H2 TCNT1H3 TCNT1H4 TCNT1H5 TCNT1H6 TCNT1H7 TCNT1L TCNT1L0 TCNT1L1 TCNT1L2 TCNT1L3 TCNT1L4 TCNT1L5 TCNT1L6
TCNT1L7 TCNT2 TCNT2_0 TCNT2_1 TCNT2_2 TCNT2_3 TCNT2_4 TCNT2_5 TCNT2_6 TCNT2_7 TCNT3 TCR2AUB TCR2BUB TIFR0 TIFR1 TIFR2
TIMSK0 TIMSK1 TIMSK2 TOIE0 TOIE1 TOIE2 TOV0 TOV1 TOV2 TSM TWA0 TWA1 TWA2 TWA3 TWA4 TWA5 TWA6 TWAM0 TWAM1 TWAM2 TWAM3
TWAM4 TWAM5 TWAM6 TWAMR TWAR TWBR TWBR0 TWBR1 TWBR2 TWBR3 TWBR4 TWBR5 TWBR6 TWBR7 TWCR TWD0 TWD1 TWD2 TWD3 TWD4 TWD5
TWD6 TWD7 TWDR TWEA TWEN TWGCE TWIE TWINT TWPS0 TWPS1 TWS3 TWS4 TWS5 TWS6 TWS7 TWSR TWSTA TWSTO TWWC TXB80 TXC0
TXCIE0 TXEN0 U2X0 UBRR0 UBRR0H UBRR0L UBRR0_0 UBRR0_1 UBRR0_10 UBRR0_11 UBRR0_2 UBRR0_3 UBRR0_4 UBRR0_5 UBRR0_6
UBRR0_7 UBRR0_8 UBRR0_9 UCPHA0 UCPOL0 UCSR0A UCSR0B UCSR0C UCSZ00 UCSZ01 UCSZ02 UDORD0 UDR0 UDR0_0 UDR0_1 UDR0_2
UDR0_3 UDR0_4 UDR0_5 UDR0_6 UDR0_7 UDRE0 UDRIE0 UMSEL00 UMSEL01 UPE0 UPM00 UPM01 USBS0 WCOL WDCE WDE WDIE WDIF WDP0
WDP1 WDP2 WDP3 WDRF WDTCSR WGM00 WGM01 WGM02 WGM10 WGM11 WGM12 WGM13 WGM20 WGM21 WGM22 XH XL XRAMEND XRAMSIZE YH YL
ZH ZL
`;

const RESERVED = new Set([RESERVED_LIST, LIBC_LIST, AVR_MACROS].join(' ').split(/\s+/).filter(Boolean));

/** Names the compiler would treat as macros/keywords even if not listed (B0101 binary literals, BIT3…). */
const isMacroLike = (s: string) =>
  /^B[01]{1,8}$/.test(s) ||
  /^BIT\d+$/.test(s) ||
  /^_[A-Z_]/.test(s) ||
  s.includes('__') ||
  /^(ESP|ARDUHAL|CONFIG|SOC|DR_REG|GPIO_NUM|RMT|LEDC|SLEEP_MODE|FUSE|SIGNATURE|AVR|SREG)_/.test(s) ||
  /_vect(_num)?$/.test(s);

/**
 * A root whose numbered variants (`root_2`, `root2`…) can never look like a
 * macro. Prefix patterns (ESP_…) and '__' survive any suffix, so such bases
 * get a `P_` prefix first (otherwise claim() would loop forever).
 */
function safeRoot(base: string): string {
  const root = base.replace(/_+$/, '') || 'nombre';
  const suffixSafe = (s: string) => !isMacroLike(`${s}_2`) && !isMacroLike(`${s}2`);
  if (suffixSafe(root)) return root;
  const alt = `P_${root}`.replace(/_{2,}/g, '_');
  return suffixSafe(alt) ? alt : 'nombre';
}

export class NameRegistry {
  private used = new Set<string>();

  has(name: string): boolean {
    return RESERVED.has(name) || isMacroLike(name) || this.used.has(name);
  }

  /** Claim `base` (or `base_2`, `base_3`…) and return the claimed name. */
  claim(base: string): string {
    let name = base;
    if (this.has(name)) {
      const root = safeRoot(base);
      name = root;
      for (let i = 2; this.has(name); i++) name = `${root}_${i}`;
    }
    this.used.add(name);
    return name;
  }

  /** First candidate (or candidate + n) not in use — NOT claimed (for block-local names). */
  free(base: string, extra: ReadonlySet<string> = new Set()): string {
    let name = base;
    if (this.has(name) || extra.has(name)) {
      const root = safeRoot(base);
      name = root;
      for (let i = 2; this.has(name) || extra.has(name); i++) name = `${root}${i}`;
    }
    return name;
  }
}

const stripAccents = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '');

/** User variable / function name → valid C identifier (keeps the user's casing). */
export function sanitizeIdentifier(name: string, fallback = 'valor'): string {
  let s = stripAccents(String(name))
    .replace(/ñ/gi, (m) => (m === 'ñ' ? 'n' : 'N'))
    .replace(/[^A-Za-z0-9_]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!s) s = fallback;
  if (/^[0-9]/.test(s)) s = `${fallback}_${s}`;
  return s;
}

/** Label → lowerCamelCase C identifier: 'Servo del brazo' → 'servoDelBrazo', 'Servo 1' → 'servo1'. */
export function lowerCamel(label: string, fallback = 'objeto'): string {
  const words = stripAccents(String(label))
    .split(/[^A-Za-z0-9]+/)
    .filter(Boolean);
  if (words.length === 0) return fallback;
  const s = words
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join('');
  return /^[0-9]/.test(s) ? `${fallback}${s}` : s;
}
