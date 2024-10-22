
<template lang='pug'>

div.loader

</template>


<style lang='sass' scoped>

.loader
    width: 200px
    height: 140px
    margin: 48px
    box-sizing: border-box
    position: relative
    border-radius: 8px
    perspective: 1000px

// The book
.loader:before
    content: ''
    position: absolute
    left: 10px
    right: 10px
    top: 10px
    bottom: 10px
    border-radius: 8px
    box-shadow: 0 0 10px rgba(0, 0, 0, 0.3)
    background-color: #f0f0f0
    background-size: 60px 5px
    background-image: linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0)
    background-position: 15px 20px, 15px 40px, 15px 60px, 15px 80px, 15px 100px, 105px 20px, 105px 40px, 105px 60px, 105px 80px, 105px 100px

// The turning page
.loader:after
    content: ''
    position: absolute
    width: calc(50% - 10px)
    right: 10px
    top: 10px
    bottom: 10px
    border-radius: 8px
    background-size: 60px 5px
    background-image: linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0), linear-gradient(#ccc 100px, transparent 0)
    background-position: 50% 20px, 50% 40px, 50% 60px, 50% 80px, 50% 100px
    transform-origin: left center
    animation: paging 2s ease-out infinite

@keyframes paging
    0%
        transform: rotateY(0deg)
        background-color: #f0f0f0
    50%
        background-color: #fff
    100%
        transform: rotateY(-180deg)
        background-color: #f0f0f0


</style>
