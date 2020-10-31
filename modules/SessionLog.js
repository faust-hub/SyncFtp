const path = require('path')
const fs = require('fs')

module.exports = class SessionLog {

    constructor (inParams, isBegin = true) {
        this.params = inParams
        this.pathLogFile = path.join(__dirname, '..', inParams.fileName)
        if (isBegin) this.begin()
    }

    begin() {
        this.body = ''
        
        if (!this.params.rewrite)
            try { 
                this.body = fs.readFileSync(this.pathLogFile).toString()
                if (this.body.length > 0) this.out(`\n${'═'.repeat(70)}\n`)
            } catch (err) {}

        let strNow = new Date().toString()            
        this.out(`${strNow}\n${'─'.repeat(strNow.length)}`)
    }

    writeStr(inStr, isGoNewLine = true) {
        if (!this.body) this.body = ''
        this.body += inStr + (isGoNewLine ? '\n' : '')
        fs.writeFileSync(this.pathLogFile, this.body)
    }

    out(...inData) {
        if (this.params.outInfo !== false) {
            let outData = ''
            inData.forEach(part => outData += (outData !== '' ? ' ' : '' ) + (typeof part !== 'object' ? part : SessionLog.objToStr(part)))
            this.writeStr(outData)
        }
    }

    outService(outMessage, title) {
        this.writeStr(`${this.params.addTimeToServiceOut ? SessionLog.makeTimeStr() : ''}${title ? title + ': ' : ''}${outMessage}`)
    }

    error(outMessage, errCode) {
        if (this.params.outErrors !== false) this.outService(outMessage, 'ERROR' + (errCode ? '(' + errCode + ')' : ''))
    }

    warning(outMessage) {
        if (this.params.outWarnings !== false) this.outService(outMessage, 'WARNING')
    }

    static objToStr(inObj) {
        return JSON.stringify(inObj, null, '\t').slice(1, -1).replace(/\"/g, '').replace(/\\\\/g, '\\')
    }

    static makeTimeStr() {
        return `[${new Date().toLocaleString('ru', { hour: 'numeric', minute: 'numeric', second: 'numeric' })}] `
    }

}