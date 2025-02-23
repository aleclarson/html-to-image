import { applyStyle } from './apply-style'
import { cloneNode, createCloneNodeContext } from './clone-node'
import { embedImages } from './embed-images'
import { embedWebFonts, getWebFontCSS } from './embed-webfonts'
import { Options } from './types'
import {
  canvasToBlob,
  checkCanvasDimensions,
  createImage,
  getImageSize,
  getPixelRatio,
  nodeToDataURL,
  svgToDataURL,
} from './util'

export async function toSvg<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<string> {
  const { width, height } = getImageSize(node, options)

  const context = createCloneNodeContext(node)
  const clonedNode = (await cloneNode(
    node,
    options,
    context,
    true,
  )) as HTMLElement

  clonedNode.style.fontSize = getComputedStyle(node).fontSize

  await embedWebFonts(clonedNode, options, context)
  await embedImages(clonedNode, options)

  applyStyle(clonedNode, options)
  return nodeToDataURL(clonedNode, width, height)
}

export async function toCanvas(
  node: HTMLElement | SVGSVGElement,
  options: Options = {},
): Promise<HTMLCanvasElement> {
  const { width, height } = getImageSize(node, options)
  const svgDataURL =
    node instanceof SVGSVGElement
      ? await svgToDataURL(node)
      : await toSvg(node, options)

  // On Firefox, the limit is 32MB. On Chromium, the limit is 512MB. On WebKit,
  // the limit is 2048MB. So check the browser type and set the limit accordingly.
  const lengthLimit =
    (navigator.userAgent.includes('Firefox')
      ? 32
      : navigator.userAgent.includes('Chromium')
      ? 512
      : 2048) *
    1024 *
    1024

  if (svgDataURL.length > lengthLimit) {
    throw new Error(
      `Element exceeds ${
        lengthLimit / 1024 / 1024
      }MB limit. Try downscaling any images used.`,
    )
  }

  const img = await createImage(svgDataURL)

  const canvas = document.createElement('canvas')
  const context = canvas.getContext('2d')!
  const ratio = options.pixelRatio || getPixelRatio()
  const canvasWidth = options.canvasWidth || width
  const canvasHeight = options.canvasHeight || height

  canvas.width = canvasWidth * ratio
  canvas.height = canvasHeight * ratio

  if (!options.skipAutoScale) {
    checkCanvasDimensions(canvas)
  }
  canvas.style.width = `${canvasWidth}`
  canvas.style.height = `${canvasHeight}`

  if (options.backgroundColor) {
    context.fillStyle = options.backgroundColor
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  context.drawImage(img, 0, 0, canvas.width, canvas.height)

  return canvas
}

export async function toPixelData<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<Uint8ClampedArray> {
  const { width, height } = getImageSize(node, options)
  const canvas = await toCanvas(node, options)
  const ctx = canvas.getContext('2d')!
  return ctx.getImageData(0, 0, width, height).data
}

export async function toDataUri<T extends HTMLElement>(
  node: T,
  options: Options & { type: string },
): Promise<string> {
  const canvas = await toCanvas(node, options)
  return canvas.toDataURL(options.type, options.quality || 1)
}

export async function toBlob<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<Blob | null> {
  const canvas = await toCanvas(node, options)
  const blob = await canvasToBlob(canvas)
  return blob
}

export async function getFontEmbedCSS<T extends HTMLElement>(
  node: T,
  options: Options = {},
): Promise<string> {
  return getWebFontCSS(node, options)
}
