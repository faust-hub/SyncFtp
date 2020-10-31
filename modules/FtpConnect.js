const fs = require('fs')
const ftp = require('ftp')
const getStream = require('get-stream')

const ERR_GET_FILE_STREAM = 995
const ERR_FAIL_RESPONSE = 996
const ERR_OVER_LIM_REQ = 997
const ERR_TIMEOUT = 998

const FORCE_CLOSE_CONNECT = 999

module.exports = class FtpConnect {

    constructor (inFtpParams, dbgLog) {
        this.params = inFtpParams
        this.poolCmd = {}
        this.connections = new Array(this.params.numThreads + 5).fill({}).map(rec => this.clearRecordConnect())

        // this.dbgOut = (...args) => dbgLog.out(...args)
        this.dbgOut = (...args) => {}
    }

    clearRecordConnect() {
        return { idCmd: null, errCode: null, ftpParams: null, connect: null }
    }

    async runCommand(inParams) {
        let idCmd 
        do { idCmd = new Date().valueOf() } while (this.poolCmd[idCmd])

        return new Promise(async resolve => {
            // this.dbgOut('IN CMD:', inParams.cmd, inParams.args, idCmd)
            
            this.poolCmd[idCmd] = {
                indConnect: -1,                
                cntTryRequest: 0,
                temporaryConnect: inParams.temporaryConnect,

                execCmd: (thisId) => {
                    if (inParams.onProgress) inParams.onProgress(inParams.objectId, 0)

                    let tmrTimeOut
                    let thisRecord = this.poolCmd[thisId]
                    let arrayArgs = inParams.args ? (Array.isArray(inParams.args) ? inParams.args : [inParams.args]) : []

                    if (inParams.cmd === 'put') {
                        if (typeof arrayArgs[0] === 'string') arrayArgs[0] = this.makeFileReadStream(arrayArgs[0], () => { this.checkCmdTryAgain(thisId) }, inParams.objectId, inParams.onProgress)
                        else this.checkCmdTryAgain(thisId)
                    } else tmrTimeOut = setTimeout(() => { this.checkCmdTryAgain(thisId) }, (inParams.temporaryConnect && inParams.temporaryConnect.timeOutRequest) || this.params.timeOutRequest)

                    this.connections[thisRecord.indConnect].connect[inParams.cmd](...arrayArgs.concat(async (...args) => {                        
                        if (tmrTimeOut) clearTimeout(tmrTimeOut)
                        
                        let result = this.parseResult(args)
                        if (inParams.isReadStream && !result.error) result = await this.getFileStream(result.data, inParams.objectId, inParams.onProgress)

                        this.runFinallyCmd(thisId, result.error, result.data, thisRecord.temporaryConnect)                        
                    }))
                },

                finallyCmd: (errorCode, resultCmd) => {
                    this.poolCmdProcessing()        
                    resolve({ error: errorCode, data: resultCmd })
                } 
            }

            this.poolCmdProcessing()
        })
    }

    runExecCmd(idCmd) {        
        if (idCmd && this.poolCmd[idCmd]) {
            this.dbgOut(`[${this.poolCmd[idCmd].indConnect}] RUN #${idCmd} - try: ${this.poolCmd[idCmd].cntTryRequest}`)

            this.poolCmd[idCmd].execCmd(idCmd)
        }
    }

    runFinallyCmd(idCmd, errorCode, resultCmd, isDestroyConnect) {
        if (idCmd && this.poolCmd[idCmd]) {
            this.dbgOut(`[${this.poolCmd[idCmd].indConnect}] END #${idCmd} - err: ${errorCode}, res: ${resultCmd ? resultCmd.length : resultCmd}, close: ${isDestroyConnect}`)

            let indConnect = this.poolCmd[idCmd].indConnect
            this.connections[indConnect].idCmd = null            
            this.poolCmd[idCmd].finallyCmd(errorCode, resultCmd)

            delete this.poolCmd[idCmd]

            if (isDestroyConnect) this.closeConnect(indConnect)
        }
    }

    checkCmdTryAgain(idCmd) {
        let recCmd = this.poolCmd[idCmd]

        if (recCmd.cntTryRequest < this.params.limTryRequest) {
            this.closeConnect(recCmd.indConnect)
            recCmd.indConnect = -1
            this.poolCmdProcessing()
        } else this.runFinallyCmd(idCmd, ERR_OVER_LIM_REQ, null, true)
    }

    poolCmdProcessing() {        
        for (let idCmd in this.poolCmd) {            
            let recCmd = this.poolCmd[idCmd]

            if (recCmd.indConnect < 0) {
                this.dbgOut('TRY START:', idCmd)

                if (!this.connections.some((recConnection, indConnect) => { 
                    if (!recConnection.errCode && !recConnection.idCmd) {
                        recConnection.idCmd = idCmd
                        recConnection.ftpParams = recCmd.temporaryConnect || this.params

                        recCmd.indConnect = indConnect
                        recCmd.cntTryRequest++
    
                        this.activateConnect(indConnect)
                        return true
                    }
                })) break                    
            }
        }
    }

    activateConnect(indConnect) {        
        let recConnect = this.connections[indConnect]

        if (!recConnect.connect) recConnect.connect = new ftp()

        if (!recConnect.connect.connected) {
            let tmrTimeOut = setTimeout(() => this.runFinallyCmd(recConnect.idCmd, ERR_TIMEOUT, null, true), recConnect.ftpParams.timeOutRequest)

            recConnect.connect.removeAllListeners()

            recConnect.connect.once('error', (error) => {
                clearTimeout(tmrTimeOut)
                this.runFinallyCmd(recConnect.idCmd, error.code, null, true)
            })

            recConnect.connect.once('ready', () => {
                clearTimeout(tmrTimeOut)                                                
                this.runExecCmd(recConnect.idCmd)           
            })

            recConnect.connect.once('close', () => {
                this.dbgOut(`[${indConnect}] END CONNECT`)

                clearTimeout(tmrTimeOut)
                this.runFinallyCmd(recConnect.idCmd, recConnect.errCode, null, false)
                this.connections[indConnect] = this.clearRecordConnect()                
                this.poolCmdProcessing()
            })

            recConnect.connect.connect(recConnect.ftpParams.connection)
        } else this.runExecCmd(recConnect.idCmd)
    }

    closeAllConnects() {
        for (let indConnect in this.connections) this.closeConnect(indConnect)
    }

    closeConnect(indConnect) {
        this.dbgOut(`[${indConnect}] CLOSE CONNECT`)

        let recConnect = this.connections[indConnect]
        if (recConnect.connect) {
            recConnect.idCmd = null
            recConnect.errCode = FORCE_CLOSE_CONNECT
            recConnect.connect.destroy()
        }
    }    

    makeFileReadStream(fileName, onTimeOut, objectId, onProgress) {
        let readStream = fs.createReadStream(fileName)
        let tmrUploadTimeOut = setTimeout(() => onTimeOut(), this.params.timeOutTransfer)

        readStream.on('data', (data) => {
            clearTimeout(tmrUploadTimeOut)
            tmrUploadTimeOut = setTimeout(() => onTimeOut(), this.params.timeOutTransfer)
            if (onProgress) onProgress(objectId, data.length)
        })

        readStream.once('close', () => clearTimeout(tmrUploadTimeOut))

        return readStream
    }

    async getFileStream(inStream, objectId, onProgress) {
        return new Promise(resolve => {
            if (inStream) {
                let tmrTimeOut = setTimeout(() => resolve({ error: ERR_TIMEOUT }), this.params.timeOutTransfer)

                inStream.on('data', (data) => {
                    clearTimeout(tmrTimeOut)
                    tmrTimeOut = setTimeout(() => resolve({ error: ERR_TIMEOUT }), this.params.timeOutTransfer)
                    if (onProgress) onProgress(objectId, data.length)
                })

                inStream.once('error', () => {
                    clearTimeout(tmrTimeOut)
                    resolve({ error: ERR_GET_FILE_STREAM })
                })

                inStream.once('close', () => clearTimeout(tmrTimeOut))
                
                let res = {}                
                getStream.buffer(inStream)
                    .then((data) => res.data = data)
                    .catch(() => res.error = ERR_GET_FILE_STREAM)
                    .finally(() => resolve(res))

            } else resolve({ error: ERR_GET_FILE_STREAM })
        })
    }

    parseResult(inData) {
        return !inData ? { error: ERR_FAIL_RESPONSE } : { 
            data: (inData.length > 1) && inData[1], 
            error: (inData.length > 0)
                ? ((typeof inData[0] === 'object') && inData[0].code) ? inData[0].code : inData[0]
                : null
        }        
    }

}