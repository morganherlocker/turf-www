#!/usr/bin/env node

const d3 = require('d3-queue')
const path = require('path')
const glob = require('glob')
const yaml = require('yamljs')
const load = require('load-json-file')
const write = require('write-json-file')
const documentation = require('documentation')

const configPath = path.join(__dirname, '..', 'src', 'assets', 'config.json')
const packagesPath = glob.sync(path.join(__dirname, '..', 'turf', 'packages', 'turf-*', 'package.json'))

const modules = []
const q = d3.queue(1)

const docs = yaml.load(path.join(__dirname, '..', 'turf', 'documentation.yml'))
docs.toc.forEach(tocItem => {
  if (tocItem.name) {
    return modules.push({
      group: tocItem.name,
      modules: []
    })
  }
  modules[modules.length - 1].modules.push({
    name: tocItem,
    hidden: false
  })
})
packagesPath.forEach(packagePath => {
  const directory = path.parse(packagePath).dir
  const indexPath = path.join(directory, 'index.js')
  const pckg = load.sync(packagePath)

  // Build Documentation
  q.defer(callback => {
    console.log('Parsing Docs:', pckg.name)
    documentation.build(indexPath, {
      shallow: true
    }).then(res => {
      if (res === undefined) return console.warning(packagePath)
      // Format JSON
      documentation.formats.json(res).then(docs => {
        docs = JSON.parse(docs)
        const parent = (docs.length > 1) ? pckg.name : null

        docs.forEach(metadata => {
          var moduleObj = getModuleObj(metadata.name)
          if (moduleObj) {
            moduleObj.parent = parent
            moduleObj.description = getDescription(metadata)
            moduleObj.snippet = getSnippet(metadata)
            moduleObj.example = getExample(metadata)
            moduleObj.hasMap = hasMap(metadata)
            moduleObj.npmName = pckg.name
            moduleObj.returns = getReturns(metadata)
            moduleObj.params = getParams(metadata)
            moduleObj.options = getOptions(metadata)
            moduleObj.throws = getThrows(metadata)
          }
        })
        callback(null)
      })
    })
  })
})

q.awaitAll(() => {
  const config = {
    modules: modules
  }
  write.sync(configPath, config)
  console.log('Saved Config:', configPath)
})

function getModuleObj (moduleName) {
  for (var i = 0; i < modules.length; i++) {
    var group = modules[i]
    for (var i2 = 0; i2 < group.modules.length; i2++) {
      if (group.modules[i2].name === moduleName) return group.modules[i2]
    }
  }
}

function getDescription (metadata) {
  return concatTags(metadata.description.children[0].children, true)
}

function getSnippet (metadata) {
  const example = metadata.examples[0]
  if (example) return example.description.split(/\n\/\/addToMap/)[0]
  return false
}

function getExample (metadata) {
  const example = metadata.examples[0]
  if (example) return example.description
  return false
}

function hasMap (metadata) {
  const example = metadata.examples[0]
  if (example) return example.description.indexOf('//addToMap') !== -1
  return false
}

function getReturns (metadata) {
  if (!metadata.returns) return false
  return metadata.returns.map(result => {
    if (!result.description.children.length) return false
    return {
      type: getType(result.type),
      desc: concatTags(result.description.children[0].children, false)
    }
  })
}

function getThrows (metadata) {
  if (!metadata.throws) return false
  return metadata.throws.map(result => {
    if (!result.description.children.length) return false
    return {
      type: getType(result.type),
      desc: concatTags(result.description.children[0].children, false)
    }
  })
}

function getParams (metadata) {
  if (!metadata.params) return false
  let outParams = metadata.params.map(param => {
    if (!param.type) return { type: null }
    if (!param.description.children.length) return false
    return {
      Argument: param.name,
      Type: getType(param.type, true),
      Description: concatTags(param.description.children[0].children),
      _lineNum: param.lineNumber
    }
  })
  outParams = outParams.filter(function (param) {
    return param.type !== null
  })
  const finalOut = outParams.sort(function (a, b) {
    return a._lineNum - b._lineNum
  })
  finalOut.forEach(function (param) {
    delete param._lineNum
  })
  return finalOut
}

function getOptions (metadata) {
  if (!metadata.params) return false
  let options = metadata.params.filter(({name}) => {
    return name === 'options'
  })
  if (options.length === 0) return null
  let outProperties = options[0].properties.map(prop => {
    let defaultVal = null
    if (prop.default) defaultVal = prop.default.replace('\\', '')
    return {
      Prop: prop.name.replace('options.', ''),
      Type: getType(prop.type),
      Default: defaultVal,
      Description: concatTags(prop.description.children[0].children, false)
    }
  })
  return outProperties
}

function concatTags (inNode, addLink) {
  if (!inNode) return false
  let outDescr = inNode.map(node => {
    if (node.children) {
      if (!addLink) return node.children[0].value
      let link = getLink(node.children[0].value)
      if (link === null || !node.jsdoc) link = node.url
      return '<a target="_blank" href="' + link + '">' + node.children[0].value + '</a>'
    }
    return node.value
  })
  outDescr = outDescr.join(' ').replace(' .', '.')
  if (outDescr === 'Optional parameters') outDescr = outDescr.concat(': see below')
  return outDescr
}

function getType (inNode, addLink) {
  if (!inNode) return false
  if (inNode.type === 'UnionType') {
    return '(' + inNode.elements.map(node => {
      return getType(node, addLink)
    }).join(' | ') + ')'
  }
  if (inNode.type === 'OptionalType') return 'Optional: ' + inNode.expression.name
  if (typeof inNode.type === 'object') return createLink(inNode.name, addLink)
  if (inNode.type === 'NameExpression') return createLink(inNode.name, addLink)
  if (inNode.type === 'TypeApplication') {
    return inNode.expression.name + ' <' + inNode.applications.map(node => {
      if (node.type === 'UnionType') {
        return '(' + node.elements.map(node2 => {
          return getType(node2, addLink)
        }).join(' | ') + ')'
      }
      if (node.type === 'TypeApplication') {
        return getType(node, addLink)
      }
      return createLink(node.name, addLink)
    }) + '>'
  }
}

Object.keys(docs.paths).forEach(name => {
  docs.paths[name.toUpperCase()] = docs.paths[name]
})

function getLink (name) {
  return docs.paths[name.toUpperCase()] || null
}

function createLink (name, addLink) {
  const link = getLink(name)
  if (!addLink || link === null) return name
  return '<a target="_blank" href="' + link + '">' + name + '</a>'
}
