# LUT Creator for OBS and other video applications

Create custom PNG and CUBE LUTs to color correct your footage using a color reference card.

## 🌟 NEW: Browser-based LUT Maker Now Available!

**Try the new web-based LUT Maker**: [https://steveseguin.github.io/LUT-maker/](https://steveseguin.github.io/LUT-maker/)

The browser tool generates LUTs without an installation or Python knowledge. Upload a photo of a color reference card, fit the correction locally in your browser, preview it, and export an OBS-compatible PNG or standard CUBE file.

Browser features include:

- Demo 3×3, SpyderCHECKR 24, and SpyderCHECKR 48 presets, plus importable/exportable JSON templates
- Notebook-compatible color sampling and regression defaults
- Optional manual perspective alignment, robust sampling, weighted regression, and QR least-squares fitting
- Basic-versus-advanced calibration quality metrics with per-patch ΔE76 values
- Background processing for responsive image previews and LUT exports
- Common 17, 32, 33, 64, and 65-point CUBE sizes with title and domain metadata

[![Walk Thru video](http://img.youtube.com/vi/pu9IpbfckDo/0.jpg)](https://www.youtube.com/watch?v=pu9IpbfckDo "Walk thru")

## About This Tool

Using accurate color samples obtained from the local paint shop, I've created tools to generate color filters that can be turned into LUTs (Look-Up Tables) to correct colors in video recordings. While not ideal for a final processed video/photo, it gets the footage to a standardized point that can be corrected with other LUTs that cannot be dynamically generated.

This repository offers two methods to create custom LUTs:

1. **NEW: Browser-based LUT Maker** - No installation required
2. **Python-based tool** - Run in Google Colab (no local setup needed)

## Python Colab Version

The original Python tool can be run on Google Colab, so no Python setup or local operation is needed - everything runs in the cloud.

**Access the Colab notebook here**: [https://colab.research.google.com/github/steveseguin/LUT-maker/blob/master/colab.ipynb](https://colab.research.google.com/github/steveseguin/LUT-maker/blob/master/colab.ipynb)

A video walk-through of this tool can be found here: [https://www.youtube.com/watch?v=pu9IpbfckDo](https://www.youtube.com/watch?v=pu9IpbfckDo)

![OBS Layout with LUT applied](https://github.com/steveseguin/LUT-maker/raw/master/obs-layout.jpg)

## LUT Types Supported

### PNG LUTs for OBS

OBS Studio comes with several LUTs, including the neutral one we've used in this repo, as displayed below.

![Neutral LUT](https://raw.githubusercontent.com/steveseguin/LUT-maker/master/neutral-lut.png)

### 3D CUBE LUT Support

Both tools can create CUBE format LUTs, which are supported by newer versions of OBS and many other video editing applications. The CUBE format is generally more accurate than PNG LUTs.

If you're using the Python Colab script, after the PNG LUT is created, there's code that will generate a `result.cube` file in the Colab files folder (access it on the left side of the Colab page). You can download it from there as needed.

The code should make it pretty easy for a novice developer to convert between LUT types. I'd love to get ICC support added directly to this Python script as well, but if you're looking to create an ICC profile, there are some Linux command-line tools that will convert from a 3D LUT to an ICC file.

## Color Card Support

### Datacolor Spyder Checkr

I created a version that's set up for the Datacolor Spyder Checkr color card:

[https://github.com/steveseguin/LUT-maker/blob/master/spyder_24_color_card.ipynb](https://github.com/steveseguin/LUT-maker/blob/master/spyder_24_color_card.ipynb)

<img src="https://raw.githubusercontent.com/steveseguin/LUT-maker/master/datacolor_sample1.png" height="300" />

## Testing

The browser's color fitting, optional QR solver, perspective mapping, robust sampling, quality metrics, rolloff curves, PNG layout, and CUBE precision have automated tests. The default path retains parity checks against the notebook behavior.

Run the unit and notebook-parity tests with:

```bash
npm test
```

Run the browser workflow tests with:

```bash
npx playwright install chromium
npm run test:e2e
```

Or run everything with `npm run test:all`.

**Note:** I'm using the main 24-color card found in the SCK100 48-color dual card pack. There's another 24-color card version that has the colors in a different arrangement; you'll need to move the values around to match your card if that's the case. (I bought mine as a 'replacement card' pack, which doesn't come with the case, but it's half the price. I don't use it often enough to justify needing a case and the added cost.)

## Licensing Information

### PNG LUT Source

The original source for the neutral PNG LUT file used by this repo was found within the OBS Studio's GitHub, [Linked Here](https://github.com/obsproject/obs-studio/blob/19fbc886fad9c2fdf220ab17f30f2389b7f4cbae/plugins/obs-filters/data/LUTs/original.png). OBS Studio uses a [GPLv2 license](https://github.com/obsproject/obs-studio/blob/19fbc886fad9c2fdf220ab17f30f2389b7f4cbae/COPYING), which allows for commercial and private use, including distribution and modification. Please see their license for specifics if intending to use their LUT. If this is an issue, provide your own PNG LUT or use the 3D CUBE LUT option instead.

### My Code License

You are free to make derivations and distributions of my Python code, for commercial or private purposes, as allowed by the GPLv3 open-source license. I went with GPLv3 for my own code. If distributing this code, modified or otherwise, providing a link with it to a fork of my repository with any changes shown I think is sufficient, although I'm not a lawyer and this is not legal advice.
