const Terminal = require('./Terminal.js')

const TASK_WAIT = 0
const TASK_PROCESS = 1
const TASK_COMPLETE = 2
const TASK_FAIL = 3
const TASK_IGNORE = 4

const SCREEN_WIDTH = 70
const MAX_LEN_PROGRESS_WORD = 4

module.exports = class TasksThreads {

    runTasks(inData) {
        Terminal.clearScreen()
        this.threads = new Array(inData.numThreads).fill(-1)
        this.poolTasks = inData.tasksItems.map(item => { return { name: item, progress: -1, status: TASK_WAIT, thread: -1 } })
        this.execTask = inData.execTask
        this.finallyTasks = inData.finallyTasks
        this.title = inData.title
        this.tryAgainConfirmHeader = inData.tryAgainConfirmHeader
        this.processingThreads()
    }

    tryAgainRunFailTasks() {
        Terminal.clearScreen()
        this.poolTasks.forEach(recTask => {
            recTask.status = (recTask.status === TASK_COMPLETE) || (recTask.status === TASK_IGNORE) ? TASK_IGNORE : TASK_WAIT
        })

        this.processingThreads()
    }

    onProgress(inName, inProgress) {
        this.poolTasks.some(task => {
            if (task.name === inName) {
                if (task.progress !== inProgress) {
                    task.progress = (inProgress !== undefined) ? inProgress : -1
                    this.updateScreen()
                }
                return true
            }
        })
    }

    async processingThreads() {
        let waitTasksInds = this.poolTasks.map((recTask, indTask) => recTask.status === TASK_WAIT ? indTask : -1).filter(item => item !== -1)

        for (let indThread in this.threads)
            if ((this.threads[indThread] < 0) && (waitTasksInds.length > 0)) {
                let indNewTask = waitTasksInds.shift()
                
                this.poolTasks[indNewTask].status = TASK_PROCESS
                this.poolTasks[indNewTask].thread = indThread
                this.threads[indThread] = indNewTask
                
                this.execTask(indNewTask).then(result => {
                    this.poolTasks[result.objectId].status = result.isSuccess ? TASK_COMPLETE : TASK_FAIL
                    this.threads[this.poolTasks[result.objectId].thread] = -1
                    this.poolTasks[result.objectId].thread = -1
                    this.processingThreads()
                })
            }

        this.updateScreen()

        if (this.threads.filter(indTask => indTask !== -1).length === 0) {
            let tasksFail = this.getTasksByStatus(TASK_FAIL)
            if (tasksFail.length > 0) {
                process.stdout.write(`${this.tryAgainConfirmHeader} (x${tasksFail.length}):\n`)
                tasksFail.forEach(recTask => process.stdout.write(`- ${recTask.name}\n`))

                if (await Terminal.inputConfirm('Try again [Y/N]?', ['Y', 'N'], 'Y') === 'Y') this.tryAgainRunFailTasks()
                else this.finallyTasks()
            } else this.finallyTasks()
        } 
    }

    getTasksByStatus(findStatus) {
        return this.poolTasks.filter(recTask => recTask.status === findStatus)
    }

    updateScreen() {
        process.stdout.write(Terminal.style.Cursor.MoveTo(0, 2))
        process.stdout.write(`┌─ ${this.title} ${'─'.repeat(SCREEN_WIDTH - this.title.length - 5)}┐\n`)
        this.outScreenClearLine()

        let numComplete = this.getTasksByStatus(TASK_COMPLETE).length
        let numFail = this.getTasksByStatus(TASK_FAIL).length
        let numAll = this.poolTasks.length - this.getTasksByStatus(TASK_IGNORE).length
        
        this.outScreenLine(Terminal.style.fg.Green + Terminal.style.Bright + numComplete + Terminal.style.Reset + '/' + Terminal.style.Bright + Terminal.style.fg.Red + numFail + Terminal.style.Reset + '/' + numAll, 26)

        let lenDone = Math.trunc((numComplete + numFail) * (SCREEN_WIDTH - 6) / numAll)
        this.outScreenLine('▓'.repeat(lenDone) + '░'.repeat(SCREEN_WIDTH - 6 - lenDone))

        this.outScreenClearLine()

        this.threads.forEach(indTask => {
            let symbList = '■'
            let outItem = ' '

            if (indTask > -1) {
                let recTask = this.poolTasks[indTask]
                let addStr = recTask.name

                if (recTask.progress !== -1) {
                    let addSpaces = MAX_LEN_PROGRESS_WORD - recTask.progress.toString().length
                    if (typeof recTask.progress === 'string') addStr = ' '.repeat(addSpaces) + recTask.progress + ' ' + addStr
                    else addStr = ' '.repeat(addSpaces - 1) + recTask.progress + '% ' + addStr
                }

                outItem += addStr
                symbList = Terminal.style.fg.Green + symbList + Terminal.style.Reset
            } else symbList = Terminal.style.fg.Gray + symbList + Terminal.style.Reset

            this.outScreenLine(symbList + outItem, symbList.length - 1)
        })

        this.outScreenClearLine('└', '─', '┘')
    }

    outScreenLine(strContent, addSpaces = 0, leftMargin = 2) {
        let lenAddSpaces = SCREEN_WIDTH - leftMargin - strContent.length + addSpaces - 2
        if (lenAddSpaces <= 0) {
            strContent = strContent.slice(0, lenAddSpaces - 4) + '... '
            lenAddSpaces = 0
        }

        process.stdout.write('│' + ' '.repeat(leftMargin) + strContent + ' '.repeat(lenAddSpaces) + '│\n')
    }

    outScreenClearLine(chLeft = '│', chMid = ' ', chRight = '│') {
        process.stdout.write(chLeft + chMid.repeat(SCREEN_WIDTH - 2) + chRight + '\n')
    }

}