module.exports = {
    dateFormat: function (date) {
        const datearray = date.split("/"); //new data
        const newdate = datearray[1] + '/' + datearray[0] + '/' + datearray[2]; //result -> mm-dd-yyyy
        return new Date(newdate)
    },

    GetActualDate: function () {
        let today = new Date(),
        date = today.getDate() + '/' + (today.getMonth() + 1) + '/' + today.getFullYear(),
        time = today.getHours() + ":" + today.getMinutes();
        return date + ' ' + time;
    }
}