import { resourceToDataURL } from './dataurl'
import { getMimeType } from './mimes'
import type { Options } from './types'
import { createUnicodeRangeRegex } from './unicode'
import {
  concatenateTextContent,
  createImage,
  dedupeArray,
  isInstanceOfElement,
  toArray,
} from './util'

type FontFace = {
  weight: string
  unicodeRange: RegExp
  style: string
  used: boolean
}

async function cloneCanvasElement(canvas: HTMLCanvasElement) {
  const dataURL = canvas.toDataURL()
  if (dataURL === 'data:,') {
    return canvas.cloneNode(false) as HTMLCanvasElement
  }
  return createImage(dataURL)
}

async function cloneVideoElement(video: HTMLVideoElement, options: Options) {
  if (video.currentSrc) {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    canvas.width = video.clientWidth
    canvas.height = video.clientHeight
    ctx?.drawImage(video, 0, 0, canvas.width, canvas.height)
    const dataURL = canvas.toDataURL()
    return createImage(dataURL)
  }

  const poster = video.poster
  const contentType = getMimeType(poster)
  const dataURL = await resourceToDataURL(poster, contentType, options)
  return createImage(dataURL)
}

async function cloneIFrameElement(iframe: HTMLIFrameElement) {
  try {
    if (iframe?.contentDocument?.body) {
      return (await cloneNode(
        iframe.contentDocument.body,
        {},
        null,
        true,
      )) as HTMLBodyElement
    }
  } catch {
    // Failed to clone iframe
  }

  return iframe.cloneNode(false) as HTMLIFrameElement
}

async function cloneSingleNode<T extends HTMLElement>(
  node: T,
  options: Options,
): Promise<HTMLElement> {
  if (isInstanceOfElement(node, HTMLCanvasElement)) {
    return cloneCanvasElement(node)
  }

  if (isInstanceOfElement(node, HTMLVideoElement)) {
    return cloneVideoElement(node, options)
  }

  if (isInstanceOfElement(node, HTMLIFrameElement)) {
    return cloneIFrameElement(node)
  }

  return node.cloneNode(false) as T
}

const isSlotElement = (node: HTMLElement): node is HTMLSlotElement =>
  node.tagName != null && node.tagName.toUpperCase() === 'SLOT'

async function cloneChildren<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  options: Options,
  context: CloneNodeContext,
): Promise<T> {
  let children: T[] = []

  if (isSlotElement(nativeNode) && nativeNode.assignedNodes) {
    children = toArray<T>(nativeNode.assignedNodes())
  } else if (
    isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
    nativeNode.contentDocument?.body
  ) {
    children = toArray<T>(nativeNode.contentDocument.body.childNodes)
  } else {
    children = toArray<T>((nativeNode.shadowRoot ?? nativeNode).childNodes)
  }

  if (
    children.length === 0 ||
    isInstanceOfElement(nativeNode, HTMLVideoElement)
  ) {
    return clonedNode
  }

  await children.reduce(
    (deferred, child) =>
      deferred
        .then(() => cloneNode(child, options, context))
        .then((clonedChild: HTMLElement | null) => {
          if (clonedChild) {
            clonedNode.appendChild(clonedChild)
          }
        }),
    Promise.resolve(),
  )

  return clonedNode
}

function cloneCSSStyle<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  context: CloneNodeContext,
) {
  const targetStyle = clonedNode.style
  if (!targetStyle) {
    return
  }

  const sourceStyle = window.getComputedStyle(nativeNode)

  const textContent = concatenateTextContent(nativeNode)
  if (textContent !== '') {
    const fontFaces = context.fonts.get(sourceStyle.fontFamily)
    if (fontFaces) {
      const eligibleFaces = fontFaces.filter(
        (face) =>
          sourceStyle.fontWeight === face.weight &&
          sourceStyle.fontStyle === face.style,
      )
      for (const char of dedupeArray(textContent.split(''))) {
        const match = eligibleFaces.find((face) => {
          if (face.unicodeRange.test(char)) {
            return (face.used = true)
          }
        })
        if (!match) {
          console.warn(
            'Failed to find font face for %s %s %s',
            sourceStyle.fontFamily,
            sourceStyle.fontWeight,
            sourceStyle.fontStyle,
          )
        }
      }
    } else {
      console.warn('Unknown font: %s', sourceStyle.fontFamily)
    }
  }

  if (nativeNode === context.rootNode) {
    const defaultStyle = getDefaultStyle(nativeNode)
    if (sourceStyle.cssText) {
      targetStyle.cssText = sourceStyle.cssText
      targetStyle.transformOrigin = sourceStyle.transformOrigin
    } else {
      toArray<string>(sourceStyle).forEach((name) => {
        let value = sourceStyle.getPropertyValue(name)
        if (value === defaultStyle[name]) {
          return
        }
        if (name === 'font-size' && value.endsWith('px')) {
          const reducedFont =
            Math.floor(parseFloat(value.substring(0, value.length - 2))) - 0.1
          value = `${reducedFont}px`
        }
        if (
          isInstanceOfElement(nativeNode, HTMLIFrameElement) &&
          name === 'display' &&
          value === 'inline'
        ) {
          value = 'block'
        }
        if (name === 'd' && clonedNode.getAttribute('d')) {
          value = `path(${clonedNode.getAttribute('d')})`
        }
        targetStyle.setProperty(
          name,
          value,
          sourceStyle.getPropertyPriority(name),
        )
      })
    }
  }
}

function getDefaultStyle(node: HTMLElement) {
  const document = node.ownerDocument

  const tmp = document.createElement('div')
  tmp.style.all = 'revert'

  node.parentElement!.appendChild(tmp)

  const style: any = getComputedStyle(tmp)
  const defaultStyle = Object.fromEntries(
    Object.values<string>(style).map((k) => [k, style[k]]),
  )

  tmp.remove()
  return defaultStyle
}

function cloneInputValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLTextAreaElement)) {
    clonedNode.innerHTML = nativeNode.value
  }

  if (isInstanceOfElement(nativeNode, HTMLInputElement)) {
    clonedNode.setAttribute('value', nativeNode.value)
  }
}

function cloneSelectValue<T extends HTMLElement>(nativeNode: T, clonedNode: T) {
  if (isInstanceOfElement(nativeNode, HTMLSelectElement)) {
    const clonedSelect = clonedNode as any as HTMLSelectElement
    const selectedOption = Array.from(clonedSelect.children).find(
      (child) => nativeNode.value === child.getAttribute('value'),
    )

    if (selectedOption) {
      selectedOption.setAttribute('selected', '')
    }
  }
}

function decorate<T extends HTMLElement>(
  nativeNode: T,
  clonedNode: T,
  context: CloneNodeContext,
): T {
  if (isInstanceOfElement(clonedNode, Element)) {
    cloneCSSStyle(nativeNode, clonedNode, context)
    // clonePseudoElements(nativeNode, clonedNode)
    cloneInputValue(nativeNode, clonedNode)
    cloneSelectValue(nativeNode, clonedNode)
  }

  return clonedNode
}

async function ensureSVGSymbols<T extends HTMLElement>(
  clone: T,
  options: Options,
  context: CloneNodeContext,
) {
  const uses = clone.querySelectorAll ? clone.querySelectorAll('use') : []
  if (uses.length === 0) {
    return clone
  }

  const processedDefs: { [key: string]: HTMLElement } = {}
  for (let i = 0; i < uses.length; i++) {
    const use = uses[i]
    const id = use.getAttribute('xlink:href')
    if (id) {
      const exist = clone.querySelector(id)
      const definition = document.querySelector(id) as HTMLElement
      if (!exist && definition && !processedDefs[id]) {
        // eslint-disable-next-line no-await-in-loop
        processedDefs[id] = (await cloneNode(
          definition,
          options,
          context,
          true,
        ))!
      }
    }
  }

  const nodes = Object.values(processedDefs)
  if (nodes.length) {
    const ns = 'http://www.w3.org/1999/xhtml'
    const svg = document.createElementNS(ns, 'svg')
    svg.setAttribute('xmlns', ns)
    svg.style.position = 'absolute'
    svg.style.width = '0'
    svg.style.height = '0'
    svg.style.overflow = 'hidden'
    svg.style.display = 'none'

    const defs = document.createElementNS(ns, 'defs')
    svg.appendChild(defs)

    for (let i = 0; i < nodes.length; i++) {
      defs.appendChild(nodes[i])
    }

    clone.appendChild(svg)
  }

  return clone
}

export async function cloneNode<T extends HTMLElement>(
  node: T,
  options: Options,
  context: CloneNodeContext,
  isRoot?: boolean,
): Promise<T | null> {
  if (!isRoot && options.filter && !options.filter(node)) {
    return null
  }

  const clonedNode = await Promise.resolve(node)
    .then((clonedNode) => cloneSingleNode(clonedNode, options) as Promise<T>)
    .then((clonedNode) => cloneChildren(node, clonedNode, options, context))
    .then((clonedNode) => decorate(node, clonedNode, context))
    .then((clonedNode) => ensureSVGSymbols(clonedNode, options, context))

  if (isRoot) {
    // applyMatchingCSSRules(clonedNode)
    const rules = getMatchingCSSRules(node)
    const styles = createStyleElementFromRules(rules)
    clonedNode.prepend(styles)
  }

  return clonedNode
}

export type CloneNodeContext = {
  rootNode: HTMLElement
  fonts: Map<string, FontFace[]>
}

export function createCloneNodeContext(rootNode: HTMLElement) {
  return {
    rootNode,
    fonts: collectFonts(rootNode.ownerDocument),
  }
}

function collectFonts(document: Document) {
  const fonts = new Map<string, FontFace[]>()
  document.fonts.forEach((font) => {
    const fontFamily = font.family.replace(/"/g, '')
    let faces = fonts.get(fontFamily)
    faces || fonts.set(fontFamily, (faces = []))
    faces.push({
      weight: font.weight,
      unicodeRange: createUnicodeRangeRegex(font.unicodeRange),
      style: font.style,
      used: false,
    })
  })
  return fonts
}

function getMatchingCSSRules(root: HTMLElement): CSSStyleRule[] {
  const matchingRules: CSSStyleRule[] = []
  const sheets = root.ownerDocument.styleSheets
  for (let i = 0; i < sheets.length; i++) {
    const sheet = sheets[i]
    try {
      const rules = sheet.cssRules || sheet.rules
      for (let j = 0; j < rules.length; j++) {
        const rule = rules[j] as CSSStyleRule
        if (root.querySelector(rule.selectorText)) {
          matchingRules.push(rule)
        }
      }
    } catch (e) {
      console.warn(`Could not read CSS rules from ${sheet.href}: ${e}`)
    }
  }
  return matchingRules
}

function createStyleElementFromRules(rules: CSSStyleRule[]): HTMLStyleElement {
  const styleElement = document.createElement('style')
  let cssText = ''
  for (let i = 0; i < rules.length; i++) {
    const rule = rules[i]
    cssText += rule.cssText
  }
  styleElement.textContent = cssText
  return styleElement
}
