const merge = require('merge')
const readline = require('readline')
const clipboardy = require('clipboardy')

const esc = (code) => `\x1b[${code}m`

const escapeCodes = {
    Reset: esc(0), Bright: esc(1), Blink: esc(5), Reverse: esc(7),
    
    fg: { 
        Black: esc(30), Red: esc(31), Green: esc(32), Yellow: esc(33), Blue: esc(34), 
        Magenta: esc(35), Cyan: esc(36), White: esc(37), Gray: esc(90)
    },

    bg: { 
        Black: esc(40), Red: esc(41), Green: esc(42), Yellow: esc(43), Blue: esc(44),     
        Magenta: esc(45), Cyan: esc(46), White: esc(47), Gray: esc(100) 
    },

    Clear: '\u001b[2J', 
    // Clear: '\u001b[0J', // DOWN CURSOR

    Cursor: {
        Hide: '\x9B\x3F\x32\x35\x6C',
        Show: '\x9B\x3F\x32\x35\x68',
        MoveTo: (x, y) => `\u001b[${y};${x}H`
    }
}

// symbols: ▼▲↔∟←→↓↑↨▬§¶‼↕◄►☼♫♪♀♂◙○◘•♠♣♦♥☻☺■

module.exports = class Terminal {

    static get style() {
        return escapeCodes
    }

    static clearScreen(cursorX = 0, cursorY = 0, isCursorShow = true) {
        process.stdout.write(escapeCodes.Clear + escapeCodes.Cursor.MoveTo(cursorX, cursorY) + (isCursorShow ? escapeCodes.Cursor.Show : escapeCodes.Cursor.Hide))
    }

    // -InputMenu
    static async inputMenu(inData) {
        let listItems = []

        for (let itemName in inData.items)
            listItems.push({ name: itemName, value: inData.items[itemName] })

        let options = {
            header: (inData.header && (inData.header.length > 0)) ? `${Terminal.style.Bright} ${inData.header}${Terminal.style.Reset}` : ''
        }

        if (inData.width !== undefined) options.width = inData.width

        while (true) {
            let menuAction = await Terminal.inputList(listItems, options)
            if (menuAction) {
                this.clearScreen()
                await menuAction()
            } else break
        }

        if (typeof inData.finalCallback === 'function') inData.finalCallback()
    }

    // -InputList
    static inputList(srcItemsList, inOptions = {}) {
        let options = merge.recursive(true, { 
            lines: 10,
            sortByName: false, 
            filtered: false, 
            filter: '', 
            header: '',
            footer: '',
            top: 2, 
            width: 53, 
            marginHoriz: 1,
            multiSelect: false,
            categories: {}, // Name: { sign:'', caption:'', signColor:escape_code }, ...
            outBottomSigns: false                
        }, inOptions)
        
        let topLine = 0
        let activeLine = 0
        let activeCategory = ''     
        let keysCategories = Object.keys(options.categories)

        srcItemsList = srcItemsList.map(record => (typeof record === 'string') ? { name: record } : record)

        if (keysCategories.length > 0) {
            srcItemsList = srcItemsList.map(record => {
                if (!record.category) record.category = keysCategories[0]
                return record
            })

            let minWidth = 8
            keysCategories.forEach(categoryName => {
                let signLen = options.categories[categoryName].sign.trim().length
                minWidth += categoryName.length + signLen + (signLen > 0 ? 2 : 0) + 3
            })

            if (options.width < minWidth) options.width = minWidth
        }


        let itemsList = srcItemsList
        if (options.filtered) itemsList = this.filterItemsList(srcItemsList, options.filter, options.sortByName, activeCategory)
        else process.stdout.write(escapeCodes.Cursor.Hide)
        
        let prevLenItemsList = itemsList.length

        return new Promise(resolve => {                
            this.outInterface(topLine, activeLine, activeCategory, options, itemsList)

            const stdinListener = (str, key) => {
                let resultItem = []
                let isRedraw = false
                let endLimit = Math.min(options.lines, itemsList.length)
                
                if (options.multiSelect && (str === '\n')) key = { name: 'return', ctrl: true }

                switch (key.name) {
                    case 'return': 
                        if (options.multiSelect && key.ctrl) resultItem = itemsList.filter(item => item.enable !== false)
                        else if (itemsList[topLine + activeLine] && (itemsList[topLine + activeLine].enable !== false)) resultItem.push(itemsList[topLine + activeLine])

                        if (resultItem.length == 0) break

                    case 'escape':
                        let outResult = resultItem.map(item => item.value !== undefined ? item.value : item.name)
                        this.extemptKeypressEvents(stdinListener, escapeCodes.Clear + escapeCodes.Cursor.Show + escapeCodes.Cursor.MoveTo(0, options.top))
                        resolve(options.multiSelect ? outResult : outResult.pop())
                    break       
                    
                    case 'tab':                        
                        if (keysCategories.length > 1) {
                            let indNow = keysCategories.indexOf(activeCategory)
                            
                            if (++indNow < keysCategories.length) activeCategory = keysCategories[indNow]
                            else activeCategory = ''
                            isRedraw = true
                        }
                    break

                    case 'up': 
                        if (activeLine > 0) activeLine--
                        else if (topLine > 0) topLine--
                        isRedraw = true
                    break

                    case 'down': 
                        if (activeLine < endLimit - 1) activeLine++
                        else if (topLine + endLimit < itemsList.length) topLine++
                        isRedraw = true
                    break

                    case 'pageup':
                        if (activeLine > 0) activeLine = 0
                        else if (topLine - options.lines - 1 > 0) topLine -= options.lines - 1
                        else topLine = 0
                        isRedraw = true
                    break

                    case 'pagedown':
                        if (activeLine < endLimit - 1) activeLine = endLimit - 1
                        else if (topLine + (endLimit * 2) - 1 < itemsList.length) topLine += options.lines - 1
                        else topLine = itemsList.length - endLimit
                        isRedraw = true
                    break

                    case 'home':
                        activeLine = 0
                        topLine = 0
                        isRedraw = true
                    break

                    case 'end':
                        activeLine = endLimit - 1
                        topLine = itemsList.length - endLimit
                        isRedraw = true
                    break

                    case 'backspace': 
                        if (options.filtered && (options.filter.length > 0)) {
                            options.filter = options.filter.slice(0, -1)
                            isRedraw = true
                        }
                    break

                    default:
                        if (str) {
                            str = str.replace(/[\f\n\r\t\v]/gi, '')                        
                            if (options.filtered && (str.length > 0)) {
                                options.filter += str
                                isRedraw = true
                            }
                        }
                }

                if (isRedraw) {
                    let isClear = false

                    if (options.filtered) {
                        itemsList = this.filterItemsList(srcItemsList, options.filter, options.sortByName, activeCategory)
                        if (itemsList.length !== prevLenItemsList) {
                            topLine = 0
                            activeLine = 0 
                            isClear = true                          
                            prevLenItemsList = itemsList.length
                        }
                    }

                    this.outInterface(topLine, activeLine, activeCategory, options, itemsList, isClear) 
                }                
            }

            this.interceptKeypressEvents(stdinListener)
        })            
    }
    
    static filterItemsList(inItemsList, filterStr, isSortByName, activeCategoryName) {
        let upperFilterStr = filterStr.toUpperCase()
        let outItemsList = inItemsList.filter(item => (item.category == '*') || ((item.name.toUpperCase().indexOf(upperFilterStr) == 0) && ((activeCategoryName == '') || (item.category == activeCategoryName))))

        if (isSortByName) outItemsList.sort((it1, it2) => (it1.category != '*') && (it1.name > it2.name) ? 1 : -1)
        return outItemsList
    }

    static outInterface(topLine, activeLine, activeCategory, options, itemsList, isClear = true) {
        let numCategories = Object.keys(options.categories).length
        let topStr = options.header + options.filter
        
        if (isClear) process.stdout.write(escapeCodes.Clear)
        process.stdout.write(escapeCodes.Cursor.MoveTo(0, options.top + (((topStr !== '') || options.filtered) ? 1 : 0)))

        this.outBorderLine({}, '', false, topLine, '▲', options.width)

        for (let line = 0; line < options.lines; line++) {
            let indexItem = topLine + line
            if (indexItem < itemsList.length) {

                let colorItem = (line == activeLine) ? escapeCodes.Reverse 
                    : (itemsList[indexItem].enable === false) ? escapeCodes.fg.Gray
                    : escapeCodes.fg.White 

                let categoryItem = ''
                let categorySignLen = 0

                if (numCategories > 0) {
                    let categoryRec = options.categories[itemsList[indexItem].category] || { sign: ' ', signColor: escapeCodes.Reset }

                    if (itemsList[indexItem].categoryColor) categoryItem = itemsList[indexItem].categoryColor + categoryRec.sign + escapeCodes.Reset 
                    else if (categoryRec.signColor) categoryItem = categoryRec.signColor + categoryRec.sign + escapeCodes.Reset 

                    categoryItem += ' '
                    categorySignLen = categoryRec.sign.length + 1
                }

                let nameItem = itemsList[indexItem].name + ' '.repeat(options.width - itemsList[indexItem].name.length - categorySignLen - (options.marginHoriz * 2))

                process.stdout.write(`${' '.repeat(options.marginHoriz)}${categoryItem}${colorItem}${nameItem}${escapeCodes.Reset}\n`)
            } else break
        }

        let footerItems = ['[ESC] - exit']
        if (numCategories > 1) footerItems.push('[TAB] - change category')
        if (options.multiSelect) footerItems.push('[CTRL+ENTER] - select all')
        
        this.outBorderLine(options.categories, options.outBottomSigns, activeCategory, itemsList.length - options.lines - topLine, '▼', options.width)
        process.stdout.write(footerItems.join(', ') + '\n' + options.footer)

        if ((topStr !== '') || options.filtered) {
            process.stdout.write(escapeCodes.Cursor.MoveTo(0, options.top) + ' '.repeat(options.width))
            process.stdout.write(escapeCodes.Cursor.MoveTo(0, options.top) + topStr)
        }
    }

    static outBorderLine(categories, isOutBottomSigns, activeCategory, numItemsOutside, signOutside, widthList) {
        let outsideStr = numItemsOutside > 0 ? signOutside : ''
        let lenDelimLine = widthList - outsideStr.length
        let numCategories = Object.keys(categories).length
        
        if (numCategories > 0) {
            let startStr = '─ '

            if (numCategories > 1) {
                startStr += `${activeCategory == '' ? escapeCodes.fg.Green : escapeCodes.fg.Gray}All${escapeCodes.Reset}`
                lenDelimLine -= 6
            }

            for (let categoryKey in categories) {
                startStr += (numCategories > 1 ? ' / ' : '') + ((numCategories == 1) || (activeCategory == categoryKey) ? escapeCodes.fg.Green : escapeCodes.fg.Gray) + categories[categoryKey].caption

                if (isOutBottomSigns && (categories[categoryKey].sign.trim().length > 0)) {                        
                    startStr += '(' + categories[categoryKey].sign + ')'
                    lenDelimLine -= 2 + categories[categoryKey].sign.length
                }

                startStr += escapeCodes.Reset
                lenDelimLine -= 3 + categories[categoryKey].caption.length
            }
            
            startStr += ' '
            process.stdout.write(startStr)
        } 

        process.stdout.write('─'.repeat(lenDelimLine) + outsideStr + '\n')
    }

    // -InputConfirm
    static inputConfirm(queryStr, answerVariants, defaultValue, autoAnswer) {
        if (autoAnswer && (autoAnswer !== '?')) 
            return new Promise(resolve => { 
                if (autoAnswer === 'default') resolve(defaultValue)
                else resolve(autoAnswer)
            })    

        if (!Array.isArray(answerVariants)) answerVariants = [answerVariants]
        
        let isExistDefaultValue = ((typeof defaultValue === 'string') && answerVariants.includes(defaultValue))
        process.stdout.write(`\n${queryStr}${isExistDefaultValue ? ` (DEFAULT - ${defaultValue})`: ''} `)

        return new Promise(resolve => {
            const exitInput = (result) => {
                this.extemptKeypressEvents(stdinListener, result + '\n')
                resolve(result)
            }

            const stdinListener = (str, key) => {
                if (isExistDefaultValue && (key.name === 'return')) exitInput(defaultValue)
                else if (str) {
                    let upperStr = str.toUpperCase()
                    if (answerVariants.includes(upperStr)) exitInput(upperStr)
                }
            }

            this.interceptKeypressEvents(stdinListener)
        })             
    }

    // -InputCheckList
    static async inputCheckList(srcItemsList, inOptions = {}) {
        let options = merge.recursive(true, {
            header: '',
            footer: '',
            addSpaces: 5,
            verticalWide: false,
            offEmptyParent: true,
            invertOutResult: false,
            outValues: true
        }, inOptions)

        let listOut = srcItemsList.map((item, index) => 
            (typeof item === 'string') ? { 
                index: index + 1, 
                name: item, 
                id: item,
                enable: true, 
            } : {
                index: index + 1,
                name: item.name,
                id: item.id || item.name,
                value: item.value,
                enable: item.enable, 
                color: item.color, 
                children: item.children
            }
        )

        while (true) {
            this.clearScreen(0, 2)            
            this.outputHeader(options.header)
            this.outCheckList(listOut, options.addSpaces, options.verticalWide)
                
            let inputVal = (await this.inputString('\n' + options.footer, '[0-9]')).toUpperCase()                
            if (inputVal !== '') this.checkSwitchItem(listOut, inputVal, true, options.offEmptyParent)
            else break
        } 

        return this.filterCheckedItems(listOut, options.invertOutResult, options.outValues)
    }

    static outCheckList(list, addSpaces, verticalWide, nowSpaces = 0, parentEnable = true) {
        list.forEach((item, ind) => {
            let isEnable = parentEnable && item.enable

            let color = escapeCodes.fg.Gray
            if (isEnable) color = item.color || escapeCodes.fg.White 
            process.stdout.write(`${' '.repeat(nowSpaces)}[${item.index}] ${color}${item.name}${escapeCodes.Reset}\n`)

            if (item.children) this.outCheckList(item.children, addSpaces, false, nowSpaces + addSpaces, isEnable)
            if (verticalWide && (ind < list.length - 1)) process.stdout.write('\n')
        })

    }

    static setTreeEnabled(list, isEnable) {
        list.forEach(item => {
            item.enable = isEnable
            if (item.children) this.setTreeEnabled(item.children, isEnable)
        })
    }

    static checkSwitchItem(list, inputVal, parentEnable, offEmptyParent) {
        let cntEnabled = list.length

        list.forEach(item => {
            if (parentEnable && (item.index == inputVal)) item.enable = !item.enable

            if (item.children && this.checkSwitchItem(item.children, inputVal, item.enable, offEmptyParent) && offEmptyParent) {
                if ((item.index == inputVal) && item.enable) this.setTreeEnabled(item.children, true)
                else item.enable = false                        
            }

            if (!item.enable) cntEnabled--
        })    

        return cntEnabled == 0
    }

    static filterCheckedItems(list, isInvertOutResult, isOutValues) {
        let resultItems = []

        list.forEach(item => {
            if ((!isInvertOutResult && item.enable) || (isInvertOutResult && !item.enable)) {
                if (isOutValues) {
                    if (item.value) resultItems.push(item.value)
                } else resultItems.push(item.id || item.index)
            }

           if (item.enable && item.children) resultItems.push(...this.filterCheckedItems(item.children, isInvertOutResult, isOutValues))
        })

        return resultItems
    }

    // -InputString
    static inputString(queryStr, permitCharRegExp, startValue) {
        let resultStr = startValue || ''
        let regExpPermit = permitCharRegExp ? new RegExp(permitCharRegExp) : null

        const addStr = (srcStr, addStr, regExpPermit) => {
            if (addStr && (!regExpPermit || regExpPermit.test(addStr))) {
                srcStr += addStr
                process.stdout.write(addStr)
            }
            return srcStr
        }

        const delStr = (srcStr, count) => {
            if (count > srcStr.length) count = srcStr.length
            process.stdout.write('\b \b'.repeat(count))
            return srcStr.slice(0, -count)
        }

        process.stdout.write(`${queryStr}: ${resultStr}`)

        return new Promise(resolve => {                

            const stdinListener = (str, key) => {
                if (key.name === 'return') { 
                    this.extemptKeypressEvents(stdinListener, '\n')
                    resolve(resultStr)
                } else if (key.name === 'escape') {
                    this.extemptKeypressEvents(stdinListener, '\n')
                    resolve('')
                } else if ((key.name === 'delete') && key.ctrl) {
                    resultStr = delStr(resultStr, resultStr.length)                    
                } else if (key.name === 'insert') {
                    if (key.shift) resultStr = addStr(resultStr, clipboardy.readSync(), regExpPermit)
                    else if (key.ctrl) clipboardy.writeSync(resultStr)
                } else if (key.name === 'backspace') {
                    resultStr = delStr(resultStr, 1)
                } else {
                    resultStr = addStr(resultStr, str, regExpPermit)
                }
            }

            this.interceptKeypressEvents(stdinListener)
        })            
    }

    // -InputAnyKey
    static inputAnyKey(queryStr) {
        if (queryStr) process.stdout.write(queryStr)
        
        return new Promise(resolve => {
            const stdinListener = (str, key) => {
                this.extemptKeypressEvents(stdinListener, '\n')
                resolve(str)
            }

            this.interceptKeypressEvents(stdinListener)
        })       
    }

    // -ThrowError
    static async throwError(message, isFatal = false, waitKeyPressText) {
        process.stdout.write(`\n${escapeCodes.Bright}${escapeCodes.fg.Red}[${isFatal ? 'FATAL ' : ''}ERROR] ${message} ${escapeCodes.Reset}\n`)
        if (waitKeyPressText) await this.inputAnyKey(waitKeyPressText)
        if (isFatal) process.exit(0)         
    }

    // -OutputHeader
    static outputHeader(headerText, underline = true) {
        let outStr = `${escapeCodes.Bright}\n${headerText}\n${escapeCodes.Reset}`
        if (underline === true) outStr += '‾'.repeat(headerText.length) + '\n'
        process.stdout.write(outStr)
        return outStr
    }

    // -OutputPanel
    static outputPanel(headerText, topPanel, widthPanel, heightPanel) {
        this.clearScreen(0, topPanel, false)
        process.stdout.write(`┌─ ${headerText} ${'─'.repeat(widthPanel - headerText.length - 5)}┐\n`)

        for (let line = 0; line < heightPanel; line++) 
            process.stdout.write('│' + ' '.repeat(widthPanel - 2) + '│\n')
        
        process.stdout.write('└' + '─'.repeat(widthPanel - 2) + '┘')
    }

    static interceptKeypressEvents(handlerFunc) {
        process.stdin.on('keypress', handlerFunc)
        readline.emitKeypressEvents(process.stdin)
        process.stdin.setRawMode(true)
        process.stdin.resume()
    }

    static extemptKeypressEvents(handlerFunc, outStr) {
        process.stdin.off('keypress', handlerFunc)
        process.stdin.pause()    
        if (outStr) process.stdout.write(outStr)
    }

}